//! The replacement goods of an exchange: sold like a sale, at today's price,
//! and taken off the shelf. A replacement of the same product that came back
//! is the exception: it is priced at what the customer paid for it.

use std::collections::HashMap;

use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ConnectionTrait, DbBackend, EntityTrait, Set, Statement,
};

use super::returns::ClaimedLine;
use crate::domain::refunds::ExchangeItemInput;
use crate::entity::{exchange_items, products};
use crate::services::transactions::load_allow_negative_stock;
use crate::utils::AppError;

/// What came back, per product: units not yet matched by a like-for-like
/// replacement, and the money those units were refunded at.
///
/// "Bisa tukar barang sama": swapping an item for the same product is
/// administrative. A line sold with a discount comes back at the discounted
/// price, so pricing its replacement at today's `sell_price` would charge the
/// customer their discount back. Matched units are priced at what was paid
/// instead; any units beyond what came back are a plain sale at `sell_price`.
pub(super) struct ReturnedCredit {
    by_product: HashMap<i64, (i64, f64)>,
}

impl ReturnedCredit {
    pub(super) fn from_lines(lines: &[ClaimedLine<'_>]) -> Self {
        let mut by_product: HashMap<i64, (i64, f64)> = HashMap::new();
        // A failed PPOB line has no product to swap like-for-like; its money
        // still counts toward the refund, just not toward a matched unit.
        for line in lines {
            let Some(product_id) = line.product_id() else {
                continue;
            };
            let entry = by_product.entry(product_id).or_insert((0, 0.0));
            entry.0 += line.quantity();
            entry.1 += line.amount;
        }
        Self { by_product }
    }

    /// Take up to `quantity` returned units of `product_id`; returns how many
    /// were matched and what they were refunded at. Taking the last unit takes
    /// the exact remaining amount, so a full like-for-like swap nets to zero.
    fn take(&mut self, product_id: i64, quantity: i64) -> (i64, f64) {
        let Some((units_left, amount_left)) = self.by_product.get_mut(&product_id) else {
            return (0, 0.0);
        };
        let matched = quantity.min(*units_left);
        if matched <= 0 {
            return (0, 0.0);
        }
        let amount = if matched == *units_left {
            *amount_left
        } else {
            *amount_left * matched as f64 / *units_left as f64
        };
        *units_left -= matched;
        *amount_left -= amount;
        (matched, amount)
    }
}

/// Write the replacement lines for refund `refund_id` and take their stock
/// off. Returns the lines and what they are worth together.
pub(super) async fn record_exchange<C: ConnectionTrait>(
    db: &C,
    refund_id: i64,
    inputs: &[ExchangeItemInput],
    credit: &mut ReturnedCredit,
    now: &str,
) -> Result<(Vec<exchange_items::Model>, f64), AppError> {
    let mut recorded = Vec::with_capacity(inputs.len());
    let mut total_exchange_amount: f64 = 0.0;

    if inputs.is_empty() {
        return Ok((recorded, total_exchange_amount));
    }

    let allow_negative_stock = load_allow_negative_stock(db).await?;

    for input in inputs {
        if input.quantity <= 0 {
            return Err(AppError::Validation(
                "Jumlah item tukar harus lebih dari 0".into(),
            ));
        }

        let product = products::Entity::find_by_id(input.product_id)
            .one(db)
            .await?
            .ok_or_else(|| {
                AppError::NotFound(format!(
                    "Produk exchange ID {} tidak ditemukan",
                    input.product_id
                ))
            })?;

        if !product.is_active {
            return Err(AppError::Validation(format!(
                "Produk '{}' tidak aktif",
                product.name
            )));
        }

        // `product.stock` was read under the up-front write lock, so no other
        // sale or refund can deduct between this check and the UPDATE below.
        if !allow_negative_stock && product.stock < input.quantity {
            return Err(AppError::Validation(format!(
                "Stok '{}' tidak cukup (tersedia: {}, diminta: {})",
                product.name, product.stock, input.quantity
            )));
        }

        let (matched, matched_amount) = credit.take(product.id, input.quantity);
        let subtotal = matched_amount + product.sell_price * (input.quantity - matched) as f64;
        let unit_price = if matched == 0 {
            product.sell_price
        } else {
            subtotal / input.quantity as f64
        };
        total_exchange_amount += subtotal;

        let exchange_item = exchange_items::ActiveModel {
            id: NotSet,
            refund_id: Set(refund_id),
            product_id: Set(input.product_id),
            product_name: Set(product.name.clone()),
            product_price: Set(unit_price),
            buy_price: Set(Some(product.buy_price)),
            quantity: Set(input.quantity),
            subtotal: Set(subtotal),
            created_at: Set(Some(now.to_string())),
        }
        .insert(db)
        .await?;
        recorded.push(exchange_item);

        db.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE products SET stock = stock - $1, updated_at = $2 WHERE id = $3",
            vec![input.quantity.into(), now.into(), input.product_id.into()],
        ))
        .await?;
    }

    Ok((recorded, total_exchange_amount))
}

#[cfg(test)]
mod tests {
    use super::super::create;
    use crate::domain::refunds::{CreateRefundInput, ExchangeItemInput};
    use crate::entity::refunds;
    use crate::services::refunds::fixtures::{actor, line, setup, sold_line, stock_of};
    use crate::test_support::insert_product;
    use sea_orm::EntityTrait;

    #[tokio::test]
    async fn exchange_returns_the_updated_amounts() {
        let conn = setup().await;

        let (_, txn, txn_item) = sold_line(&conn, "Sarung", 40_000.0, 60_000.0, 10, 1).await;
        let replacement = insert_product(&conn, "Peci", 25_000.0, 45_000.0, 10).await;

        let result = create(
            &conn,
            &actor(),
            CreateRefundInput {
                transaction_id: txn.id,
                reason: Some("Tukar model".to_string()),
                items: vec![line(txn_item.id, 1, "good")],
                exchange_items: Some(vec![ExchangeItemInput {
                    product_id: replacement.id,
                    quantity: 1,
                }]),
            },
        )
        .await
        .expect("exchange should succeed");

        assert_eq!(result.refund.refund_type, "exchange");
        assert_eq!(result.refund.total_refund_amount, 60_000.0);
        assert_eq!(result.refund.total_exchange_amount, Some(45_000.0));
        assert_eq!(result.refund.difference_amount, Some(15_000.0));

        // The persisted row and the returned model agree.
        let stored = refunds::Entity::find_by_id(result.refund.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("refund exists");
        assert_eq!(stored.total_exchange_amount, Some(45_000.0));
        assert_eq!(stored.difference_amount, Some(15_000.0));

        // The replacement left the shelf.
        assert_eq!(stock_of(&conn, replacement.id).await, 9);
    }
}

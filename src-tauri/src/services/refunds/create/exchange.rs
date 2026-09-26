//! The replacement goods of an exchange: sold like a sale, at today's price,
//! and taken off the shelf.

use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ConnectionTrait, DbBackend, EntityTrait, Set, Statement,
};

use crate::domain::refunds::ExchangeItemInput;
use crate::entity::{exchange_items, products};
use crate::services::transactions::load_allow_negative_stock;
use crate::utils::AppError;

/// Write the replacement lines for refund `refund_id` and take their stock
/// off. Returns the lines and what they are worth together.
pub(super) async fn record_exchange<C: ConnectionTrait>(
    db: &C,
    refund_id: i64,
    inputs: &[ExchangeItemInput],
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

        // Guard against overselling. product.stock was read above under the
        // up-front write lock, so this check-then-deduct is consistent: no
        // concurrent refund/sale can slip a deduction in between, which would
        // otherwise let stock go negative when it isn't allowed.
        if !allow_negative_stock && product.stock < input.quantity {
            return Err(AppError::Validation(format!(
                "Stok '{}' tidak cukup (tersedia: {}, diminta: {})",
                product.name, product.stock, input.quantity
            )));
        }

        let subtotal = product.sell_price * input.quantity as f64;
        total_exchange_amount += subtotal;

        let exchange_item = exchange_items::ActiveModel {
            id: NotSet,
            refund_id: Set(refund_id),
            product_id: Set(input.product_id),
            product_name: Set(product.name.clone()),
            product_price: Set(product.sell_price),
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

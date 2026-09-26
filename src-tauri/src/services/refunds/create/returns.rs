//! The goods coming back: how much of each sold line is still returnable, what
//! each returned line is worth, where it goes (back on the shelf, or written
//! off), and whether the sale is now fully or partly refunded.

use std::collections::HashMap;

use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ConnectionTrait, DbBackend, EntityTrait, Set, Statement,
};

use super::super::refund_amount_for;
use crate::domain::refunds::RefundItemInput;
use crate::domain::Actor;
use crate::entity::{products, refund_items, refunds, stock_writeoffs, transaction_items};
use crate::services::document_number::next_writeoff_number;
use crate::utils::AppError;

/// One validated returned line: the sold line it points at, the product whose
/// stock it moves, and the money it hands back.
pub(super) struct ClaimedLine<'a> {
    input: &'a RefundItemInput,
    txn_item: &'a transaction_items::Model,
    product_id: i64,
    pub(super) amount: f64,
}

/// Resolves the sold line a refund input points at, together with the product
/// whose stock it moves. Both come from the transaction itself, never from the
/// client: `transaction_item_id` is the only thing a caller gets to choose, and
/// it is checked against the lines of the transaction being refunded.
///
/// PPOB lines carry no `product_id` — there is no physical stock to give back —
/// so they are rejected here rather than failing later on a NOT NULL column.
fn resolve_refund_line<'a>(
    txn_items: &'a [transaction_items::Model],
    item_input: &RefundItemInput,
) -> Result<(&'a transaction_items::Model, i64), AppError> {
    let txn_item = txn_items
        .iter()
        .find(|ti| ti.id == item_input.transaction_item_id)
        .ok_or_else(|| {
            AppError::Validation(format!(
                "Item transaksi ID {} tidak ditemukan dalam transaksi ini",
                item_input.transaction_item_id
            ))
        })?;

    let product_id = txn_item.product_id.ok_or_else(|| {
        AppError::Validation(format!(
            "'{}' bukan produk fisik dan tidak bisa di-refund",
            txn_item.product_name
        ))
    })?;

    Ok((txn_item, product_id))
}

/// Units returned per sold line (`transaction_items.id`): by earlier refunds of
/// this sale, and by the lines of the refund being recorded.
pub(super) struct RefundTally {
    already_refunded: HashMap<i64, i64>,
    claimed_here: HashMap<i64, i64>,
}

impl RefundTally {
    /// What earlier refunds of `transaction_id` already took back.
    pub(super) async fn load<C: ConnectionTrait>(
        db: &C,
        transaction_id: i64,
    ) -> Result<Self, AppError> {
        let already_refunded = super::super::refunded_quantities(db, transaction_id).await?;

        Ok(Self {
            already_refunded,
            claimed_here: HashMap::new(),
        })
    }

    fn returned(&self, transaction_item_id: i64) -> i64 {
        self.already_refunded
            .get(&transaction_item_id)
            .copied()
            .unwrap_or(0)
            + self
                .claimed_here
                .get(&transaction_item_id)
                .copied()
                .unwrap_or(0)
    }

    /// Validates every requested line against what is left of its sold line and
    /// adds it to the tally.
    ///
    /// The tally is cumulative within the request too, so two lines naming the
    /// same sold line (one good, one damaged) cannot together return more than
    /// was bought — defence in depth alongside the up-front write lock, which
    /// prevents cross-request races.
    pub(super) fn claim<'a>(
        &mut self,
        txn_items: &'a [transaction_items::Model],
        inputs: &'a [RefundItemInput],
    ) -> Result<Vec<ClaimedLine<'a>>, AppError> {
        let mut claimed = Vec::with_capacity(inputs.len());

        for input in inputs {
            let (txn_item, product_id) = resolve_refund_line(txn_items, input)?;
            let available_qty = txn_item.quantity - self.returned(input.transaction_item_id);

            if input.quantity > available_qty {
                return Err(AppError::Validation(format!(
                    "Jumlah refund {} melebihi sisa yang bisa di-refund ({}) untuk {}",
                    input.quantity, available_qty, txn_item.product_name
                )));
            }

            *self
                .claimed_here
                .entry(input.transaction_item_id)
                .or_insert(0) += input.quantity;

            claimed.push(ClaimedLine {
                input,
                txn_item,
                product_id,
                amount: refund_amount_for(txn_item, input.quantity),
            });
        }

        Ok(claimed)
    }

    /// The sale's status once this refund is in: `refunded` when every unit
    /// sold has come back, `partial_refund` otherwise.
    ///
    /// Counted per unit across the whole tally, not by matching the first input
    /// line per item: a mixed-condition return sends the same transaction item
    /// twice (one good, one damaged), and counting only the first line left a
    /// fully refunded sale stuck at `partial_refund` forever — where shift
    /// closing and the reports keep counting it at full value.
    pub(super) fn settled_status(&self, txn_items: &[transaction_items::Model]) -> &'static str {
        let total_refunded_qty: i64 = txn_items.iter().map(|ti| self.returned(ti.id)).sum();
        let total_original_qty: i64 = txn_items.iter().map(|ti| ti.quantity).sum();

        if total_refunded_qty >= total_original_qty {
            "refunded"
        } else {
            "partial_refund"
        }
    }
}

/// Write the refund's lines. Goods in good condition go back on the shelf;
/// damaged or expired goods stay off it and are written off instead.
pub(super) async fn record_returned_lines<C: ConnectionTrait>(
    db: &C,
    actor: &Actor,
    refund: &refunds::Model,
    lines: &[ClaimedLine<'_>],
    now: &str,
) -> Result<Vec<refund_items::Model>, AppError> {
    let mut recorded = Vec::with_capacity(lines.len());

    for line in lines {
        let refund_item = refund_items::ActiveModel {
            id: NotSet,
            refund_id: Set(refund.id),
            transaction_item_id: Set(line.txn_item.id),
            product_id: Set(line.product_id),
            quantity: Set(line.input.quantity),
            subtotal: Set(line.amount),
            condition: Set(Some(line.input.condition.clone())),
            created_at: Set(Some(now.to_string())),
        }
        .insert(db)
        .await?;
        recorded.push(refund_item);

        if line.input.condition == "good" {
            restock(db, line, now).await?;
        } else {
            write_off(db, actor, refund, line, now).await?;
        }
    }

    Ok(recorded)
}

async fn restock<C: ConnectionTrait>(
    db: &C,
    line: &ClaimedLine<'_>,
    now: &str,
) -> Result<(), AppError> {
    db.execute(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "UPDATE products SET stock = stock + $1, updated_at = $2 WHERE id = $3",
        vec![
            line.input.quantity.into(),
            now.into(),
            line.product_id.into(),
        ],
    ))
    .await?;

    Ok(())
}

/// What one unit of the returned line cost the shop: the buy price snapshotted
/// on the sold line, which is what the sale's profit was computed against.
/// Only lines sold before the snapshot existed (`buy_price` NULL) fall back to
/// the product's current buy price. Valuing every return at today's price made
/// the same broken item a different loss depending on when the price last
/// changed, and disagreed with the cost the reports take back off the sale.
async fn unit_cost<C: ConnectionTrait>(db: &C, line: &ClaimedLine<'_>) -> Result<f64, AppError> {
    if let Some(buy_price) = line.txn_item.buy_price {
        return Ok(buy_price);
    }

    let product = products::Entity::find_by_id(line.product_id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Produk tidak ditemukan".into()))?;

    Ok(product.buy_price)
}

/// Book a damaged/expired return as a loss. Stock is NOT restored: the goods
/// were sold, and they are not going back on the shelf.
async fn write_off<C: ConnectionTrait>(
    db: &C,
    actor: &Actor,
    refund: &refunds::Model,
    line: &ClaimedLine<'_>,
    now: &str,
) -> Result<(), AppError> {
    let unit_cost = unit_cost(db, line).await?;

    let writeoff_number = next_writeoff_number(db).await?;

    stock_writeoffs::ActiveModel {
        id: NotSet,
        writeoff_number: Set(writeoff_number),
        product_id: Set(line.product_id),
        user_id: Set(actor.user_id),
        quantity: Set(line.input.quantity),
        reason: Set(line.input.condition.clone()),
        loss_value: Set(unit_cost * line.input.quantity as f64),
        notes: Set(Some(format!(
            "Auto write-off dari refund {}",
            refund.refund_number
        ))),
        // Approved on creation, like every other damaged/expired write-off (see
        // `services::stock::create`). The customer just put the broken goods on
        // the counter, so the evidence rule is satisfied more plainly here than
        // anywhere else. Leaving these `pending` kept them out of the loss
        // report — which counts `approved` rows only — so returns of damaged
        // goods, the most predictable loss a shop has, went unreported until
        // somebody clicked approve on a screen that changes nothing.
        approved_by: Set(Some(actor.user_id)),
        status: Set("approved".to_string()),
        refund_id: Set(Some(refund.id)),
        created_at: Set(Some(now.to_string())),
    }
    .insert(db)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::create;
    use crate::entity::{stock_writeoffs, transactions};
    use crate::services::refunds::fixtures::{
        actor, line, refund_input, refund_of, refund_one, sale, setup, sold_line, stock_of,
    };
    use crate::test_support::{
        insert_product, insert_transaction_item, insert_transaction_item_spec, TransactionItemSpec,
    };
    use crate::utils::AppError;
    use sea_orm::{
        ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait, QueryFilter,
        Statement,
    };

    async fn status_of(conn: &DatabaseConnection, txn_id: i64) -> String {
        transactions::Entity::find_by_id(txn_id)
            .one(conn)
            .await
            .expect("query")
            .expect("transaction exists")
            .status
    }

    #[tokio::test]
    async fn refund_split_across_two_lines_closes_the_sale() {
        let conn = setup().await;
        let (_, txn, txn_item) = sold_line(&conn, "Piring", 6_000.0, 10_000.0, 20, 2).await;

        // A legitimate mixed-condition return: both units come back, one intact
        // and one broken, so the customer sends two lines for the same item.
        create(
            &conn,
            &actor(),
            refund_of(
                txn.id,
                vec![
                    line(txn_item.id, 1, "good"),
                    line(txn_item.id, 1, "damaged"),
                ],
            ),
        )
        .await
        .expect("refund should succeed");

        assert_eq!(status_of(&conn, txn.id).await, "refunded");
    }

    #[tokio::test]
    async fn refund_returns_the_price_paid_after_the_item_discount() {
        let conn = setup().await;

        let product = insert_product(&conn, "Minyak 2L", 30_000.0, 50_000.0, 5).await;
        // Bought at 50.000 with a 10.000 line discount, so 40.000 changed hands.
        let txn = sale(&conn, 40_000.0).await;
        let txn_item = insert_transaction_item_spec(
            &conn,
            TransactionItemSpec {
                transaction_id: txn.id,
                product_id: Some(product.id),
                product_name: "Minyak 2L",
                product_price: 50_000.0,
                buy_price: 30_000.0,
                quantity: 1,
                item_discount: 10_000.0,
                net_subtotal: None,
            },
        )
        .await;

        let result = create(&conn, &actor(), refund_one(txn.id, txn_item.id))
            .await
            .expect("refund should succeed");

        assert_eq!(result.refund.total_refund_amount, 40_000.0);
        assert_eq!(result.items[0].subtotal, 40_000.0);
    }

    #[tokio::test]
    async fn refund_prorates_the_transaction_discount_per_unit() {
        let conn = setup().await;

        let product = insert_product(&conn, "Susu Kaleng", 12_000.0, 20_000.0, 10).await;
        // 3 x 20.000 = 60.000, minus a 6.000 line discount = 54.000, minus this
        // line's share of the transaction discount = 45.000 paid, 15.000 a unit.
        let txn = sale(&conn, 45_000.0).await;
        let txn_item = insert_transaction_item_spec(
            &conn,
            TransactionItemSpec {
                transaction_id: txn.id,
                product_id: Some(product.id),
                product_name: "Susu Kaleng",
                product_price: 20_000.0,
                buy_price: 12_000.0,
                quantity: 3,
                item_discount: 6_000.0,
                net_subtotal: Some(45_000.0),
            },
        )
        .await;

        let result = create(
            &conn,
            &actor(),
            refund_of(txn.id, vec![line(txn_item.id, 2, "good")]),
        )
        .await
        .expect("refund should succeed");

        assert_eq!(result.refund.total_refund_amount, 30_000.0);
        assert_eq!(result.items[0].subtotal, 30_000.0);
    }

    #[tokio::test]
    async fn refund_ignores_client_supplied_product_id() {
        let conn = setup().await;

        let soap = insert_product(&conn, "Sabun", 3_000.0, 5_000.0, 10).await;
        let rice = insert_product(&conn, "Beras 25kg", 250_000.0, 300_000.0, 4).await;
        let txn = sale(&conn, 5_000.0).await;
        let txn_item =
            insert_transaction_item(&conn, txn.id, Some(soap.id), "Sabun", 5_000.0, 3_000.0, 1)
                .await;

        // A tampered payload refunds a Rp 5.000 soap while naming the 25kg rice
        // sack, which used to conjure rice stock out of nothing.
        let result = create(
            &conn,
            &actor(),
            refund_input(serde_json::json!({
                "transaction_id": txn.id,
                "user_id": 1,
                "reason": "Salah beli",
                "items": [{
                    "transaction_item_id": txn_item.id,
                    "product_id": rice.id,
                    "quantity": 1,
                    "condition": "good"
                }],
                "exchange_items": null
            })),
        )
        .await
        .expect("refund should succeed");

        assert_eq!(result.items[0].product_id, soap.id);
        assert_eq!(stock_of(&conn, soap.id).await, 11);
        assert_eq!(stock_of(&conn, rice.id).await, 4);
    }

    #[tokio::test]
    async fn refund_writeoff_uses_the_sold_product_cost() {
        let conn = setup().await;

        let soap = insert_product(&conn, "Sabun", 3_000.0, 5_000.0, 10).await;
        let rice = insert_product(&conn, "Beras 25kg", 250_000.0, 300_000.0, 4).await;
        let txn = sale(&conn, 5_000.0).await;
        let txn_item =
            insert_transaction_item(&conn, txn.id, Some(soap.id), "Sabun", 5_000.0, 3_000.0, 1)
                .await;

        let result = create(
            &conn,
            &actor(),
            refund_input(serde_json::json!({
                "transaction_id": txn.id,
                "user_id": 1,
                "reason": "Rusak",
                "items": [{
                    "transaction_item_id": txn_item.id,
                    "product_id": rice.id,
                    "quantity": 1,
                    "condition": "damaged"
                }],
                "exchange_items": null
            })),
        )
        .await
        .expect("refund should succeed");

        let writeoffs = stock_writeoffs::Entity::find()
            .filter(stock_writeoffs::Column::RefundId.eq(result.refund.id))
            .all(&conn)
            .await
            .expect("query writeoffs");

        assert_eq!(writeoffs.len(), 1);
        // The loss is the soap's cost price, not the rice sack's.
        assert_eq!(writeoffs[0].product_id, soap.id);
        assert_eq!(writeoffs[0].loss_value, 3_000.0);
    }

    async fn damaged_writeoff_loss(conn: &DatabaseConnection, txn_id: i64, item_id: i64) -> f64 {
        let result = create(
            conn,
            &actor(),
            refund_of(txn_id, vec![line(item_id, 1, "damaged")]),
        )
        .await
        .expect("refund should succeed");

        let writeoffs = stock_writeoffs::Entity::find()
            .filter(stock_writeoffs::Column::RefundId.eq(result.refund.id))
            .all(conn)
            .await
            .expect("query writeoffs");
        assert_eq!(writeoffs.len(), 1);
        writeoffs[0].loss_value
    }

    async fn set_product_buy_price(conn: &DatabaseConnection, product_id: i64, buy_price: f64) {
        conn.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE products SET buy_price = $1 WHERE id = $2",
            vec![buy_price.into(), product_id.into()],
        ))
        .await
        .expect("update buy price");
    }

    /// The buy price went up after the sale. The loss is what the returned
    /// unit cost when it was sold (the line's snapshot), not today's price.
    #[tokio::test]
    async fn a_damaged_return_is_valued_at_the_sold_lines_buy_price() {
        let conn = setup().await;
        let (product, txn, txn_item) =
            sold_line(&conn, "Minyak 2L", 30_000.0, 38_000.0, 20, 2).await;
        set_product_buy_price(&conn, product.id, 34_000.0).await;

        let loss = damaged_writeoff_loss(&conn, txn.id, txn_item.id).await;

        assert_eq!(loss, 30_000.0);
    }

    /// A line sold before the snapshot column existed has no buy price of its
    /// own; the product's current buy price is the only figure left.
    #[tokio::test]
    async fn a_damaged_return_without_a_snapshot_falls_back_to_the_product() {
        let conn = setup().await;
        let (product, txn, txn_item) =
            sold_line(&conn, "Minyak 2L", 30_000.0, 38_000.0, 20, 2).await;
        conn.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "UPDATE transaction_items SET buy_price = NULL WHERE id = $1",
            vec![txn_item.id.into()],
        ))
        .await
        .expect("clear snapshot");
        set_product_buy_price(&conn, product.id, 34_000.0).await;

        let loss = damaged_writeoff_loss(&conn, txn.id, txn_item.id).await;

        assert_eq!(loss, 34_000.0);
    }

    #[tokio::test]
    async fn refund_rejects_transaction_item_without_product() {
        let conn = setup().await;

        let txn = sale(&conn, 12_000.0).await;
        // PPOB lines carry no product_id; there is no stock to give back.
        let txn_item =
            insert_transaction_item(&conn, txn.id, None, "Pulsa 10K", 12_000.0, 10_000.0, 1).await;

        let result = create(
            &conn,
            &actor(),
            refund_input(serde_json::json!({
                "transaction_id": txn.id,
                "user_id": 1,
                "reason": null,
                "items": [{
                    "transaction_item_id": txn_item.id,
                    "quantity": 1,
                    "condition": "good"
                }],
                "exchange_items": null
            })),
        )
        .await;

        match result {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("Pulsa 10K"),
                    "Error should name the offending line, got: {msg}"
                );
            }
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn a_damaged_return_books_an_approved_writeoff() {
        let conn = setup().await;
        let (product, txn, txn_item) =
            sold_line(&conn, "Beras 5kg", 50_000.0, 65_000.0, 100, 2).await;

        let result = create(
            &conn,
            &actor(),
            refund_of(txn.id, vec![line(txn_item.id, 1, "damaged")]),
        )
        .await
        .expect("refund should succeed");

        let writeoffs = stock_writeoffs::Entity::find()
            .filter(stock_writeoffs::Column::RefundId.eq(result.refund.id))
            .all(&conn)
            .await
            .expect("query writeoffs");

        assert_eq!(writeoffs.len(), 1);
        assert_eq!(
            writeoffs[0].status, "approved",
            "the damaged goods are on the counter — the loss is real now, not \
             once somebody clicks approve"
        );
        assert_eq!(writeoffs[0].approved_by, Some(1));
        assert_eq!(writeoffs[0].reason, "damaged");
        assert_eq!(writeoffs[0].quantity, 1);
        assert_eq!(writeoffs[0].loss_value, 50_000.0); // buy_price * quantity
        assert_eq!(writeoffs[0].product_id, product.id);
    }

    #[tokio::test]
    async fn test_refund_good_condition_restores_stock() {
        let conn = setup().await;
        let (product, txn, txn_item) =
            sold_line(&conn, "Gula Pasir", 10_000.0, 15_000.0, 50, 2).await;

        create(&conn, &actor(), refund_one(txn.id, txn_item.id))
            .await
            .expect("refund should succeed");

        // Stock should be restored: 50 + 1 = 51
        assert_eq!(stock_of(&conn, product.id).await, 51);

        // No write-off should be created for good condition items
        let writeoffs = stock_writeoffs::Entity::find()
            .filter(stock_writeoffs::Column::ProductId.eq(product.id))
            .all(&conn)
            .await
            .expect("query writeoffs");
        assert_eq!(writeoffs.len(), 0);
    }

    #[tokio::test]
    async fn test_refund_sets_transaction_status_to_partial() {
        let conn = setup().await;
        let (_, txn, txn_item) = sold_line(&conn, "Kecap", 5_000.0, 8_000.0, 50, 2).await;

        // Refund only 1 of 2 items -> partial_refund
        create(&conn, &actor(), refund_one(txn.id, txn_item.id))
            .await
            .expect("refund should succeed");

        assert_eq!(status_of(&conn, txn.id).await, "partial_refund");
    }

    #[tokio::test]
    async fn test_full_refund_sets_transaction_status_to_refunded() {
        let conn = setup().await;
        let (_, txn, txn_item) = sold_line(&conn, "Sambal", 7_000.0, 10_000.0, 30, 1).await;

        // Refund all items -> refunded
        create(&conn, &actor(), refund_one(txn.id, txn_item.id))
            .await
            .expect("refund should succeed");

        assert_eq!(status_of(&conn, txn.id).await, "refunded");
    }
}

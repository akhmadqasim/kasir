//! Recording a refund or exchange.

use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, ConnectionTrait, DatabaseConnection,
    DbBackend, EntityTrait, QueryFilter, Set, Statement, TransactionTrait,
};

use super::{
    generate_refund_number, generate_writeoff_number, refund_amount_for, resolve_refund_line,
    REFUND_MAX_DAYS, VALID_CONDITIONS,
};
use crate::domain::refunds::{CreateRefundInput, RefundResult};
use crate::domain::settings::parse_app_settings;
use crate::domain::Actor;
use crate::entity::{
    exchange_items, products, refund_items, refunds, stock_writeoffs, store_info,
    transaction_items, transactions,
};
use crate::utils::AppError;

/// Record a return, and the replacement goods when it is an exchange.
///
/// The actor is recorded on the refund and on any write-off it raises; nothing
/// in the request body decides who did it.
pub async fn create(
    db: &DatabaseConnection,
    actor: &Actor,
    input: CreateRefundInput,
) -> Result<RefundResult, AppError> {
    if input.items.is_empty() {
        return Err(AppError::Validation(
            "Item refund tidak boleh kosong".into(),
        ));
    }

    // Validate conditions
    for item in &input.items {
        if !VALID_CONDITIONS.contains(&item.condition.as_str()) {
            return Err(AppError::Validation(format!(
                "Kondisi barang tidak valid: {}",
                item.condition
            )));
        }
        if item.quantity <= 0 {
            return Err(AppError::Validation(
                "Jumlah refund harus lebih dari 0".into(),
            ));
        }
    }

    let txn = db.begin().await?;

    // Acquire the SQLite write lock up front (emulate BEGIN IMMEDIATE) so the
    // already-refunded tally and exchange stock reads below are consistent and
    // no concurrent refund of the same transaction can interleave between our
    // reads and our writes. sea-orm's begin()/begin_with_config() only issue a
    // DEFERRED `BEGIN` for SQLite (access mode is ignored), which would let two
    // interleaving refunds each read a stale tally and both pass. Forcing an
    // early (no-op) write escalates to the reserved write lock; a second refund
    // then serializes on it (busy_timeout) and re-reads the fresh totals below.
    txn.execute(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "UPDATE transactions SET status = status WHERE id = $1",
        vec![input.transaction_id.into()],
    ))
    .await?;

    // Get original transaction
    let transaction = transactions::Entity::find_by_id(input.transaction_id)
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound("Transaksi tidak ditemukan".into()))?;

    // Check status
    if transaction.status == "refunded" {
        return Err(AppError::Validation(
            "Transaksi sudah di-refund sepenuhnya".into(),
        ));
    }

    // A void already restored the stock and zeroed the total. Refunding on top
    // would restore that stock a second time, overwrite `deleted` with
    // `refunded` while deleted_at/deleted_by stay filled in, and print a Rp 0
    // refund receipt. `delete_transaction` guards the reverse order already.
    if transaction.status == "deleted" || transaction.deleted_at.is_some() {
        return Err(AppError::Validation(
            "Transaksi sudah dibatalkan dan tidak bisa di-refund".into(),
        ));
    }

    // Check the 7-day limit.
    //
    // A missing timestamp cannot be shown to fall inside the window, and the
    // old code skipped the check entirely for those rows, so treat it as
    // non-refundable rather than unlimited.
    let created_at = transaction.created_at.as_deref().ok_or_else(|| {
        AppError::Validation("Transaksi tanpa tanggal tidak bisa di-refund".into())
    })?;

    let txn_date = chrono::NaiveDateTime::parse_from_str(created_at, "%Y-%m-%d %H:%M:%S")
        .map_err(|_| AppError::Internal("Format tanggal transaksi tidak valid".into()))?;

    // Compare durations, not whole days: `num_days()` truncates toward zero, so
    // `days > 7` stayed false until 7d23h59m and the "7 day" rule really ran for
    // almost eight.
    let age = chrono::Utc::now()
        .naive_utc()
        .signed_duration_since(txn_date);
    if age > chrono::Duration::days(REFUND_MAX_DAYS) {
        return Err(AppError::Validation(format!(
            "Refund hanya bisa dilakukan maksimal {} hari setelah pembelian",
            REFUND_MAX_DAYS
        )));
    }

    // Load transaction items for validation
    let txn_items = transaction_items::Entity::find()
        .filter(transaction_items::Column::TransactionId.eq(input.transaction_id))
        .all(&txn)
        .await?;

    // Load existing refund items for this transaction to check already-refunded quantities
    let existing_refunds = refunds::Entity::find()
        .filter(refunds::Column::TransactionId.eq(input.transaction_id))
        .all(&txn)
        .await?;

    let mut existing_refund_qty: std::collections::HashMap<i64, i64> =
        std::collections::HashMap::new();

    for existing_refund in &existing_refunds {
        let existing_items = refund_items::Entity::find()
            .filter(refund_items::Column::RefundId.eq(existing_refund.id))
            .all(&txn)
            .await?;
        for ei in existing_items {
            *existing_refund_qty
                .entry(ei.transaction_item_id)
                .or_insert(0) += ei.quantity;
        }
    }

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let refund_number = generate_refund_number(&txn).await?;

    let mut total_refund_amount: f64 = 0.0;
    let mut refund_items_result: Vec<refund_items::Model> = Vec::new();

    // Track quantities requested within THIS refund so multiple lines referring
    // to the same transaction item are validated cumulatively (defense-in-depth
    // alongside the up-front write lock, which prevents cross-request races).
    let mut requested_in_this_refund: std::collections::HashMap<i64, i64> =
        std::collections::HashMap::new();

    for item_input in &input.items {
        // Validate transaction item exists and belongs to this transaction
        let (txn_item, _) = resolve_refund_line(&txn_items, item_input)?;

        // Check refund quantity doesn't exceed purchased quantity minus already
        // refunded (in prior refunds) and minus quantity already claimed by
        // earlier lines of this same request.
        let already_refunded = existing_refund_qty
            .get(&item_input.transaction_item_id)
            .copied()
            .unwrap_or(0);
        let claimed_here = requested_in_this_refund
            .get(&item_input.transaction_item_id)
            .copied()
            .unwrap_or(0);
        let available_qty = txn_item.quantity - already_refunded - claimed_here;

        if item_input.quantity > available_qty {
            return Err(AppError::Validation(format!(
                "Jumlah refund {} melebihi sisa yang bisa di-refund ({}) untuk {}",
                item_input.quantity, available_qty, txn_item.product_name
            )));
        }

        *requested_in_this_refund
            .entry(item_input.transaction_item_id)
            .or_insert(0) += item_input.quantity;

        total_refund_amount += refund_amount_for(txn_item, item_input.quantity);

        // Create refund item (will set refund_id after refund is created)
    }

    // Determine refund type based on exchange items
    let has_exchange = input
        .exchange_items
        .as_ref()
        .map(|items| !items.is_empty())
        .unwrap_or(false);
    let refund_type = if has_exchange { "exchange" } else { "refund" };

    // Create refund record
    let new_refund = refunds::ActiveModel {
        id: NotSet,
        refund_number: Set(refund_number),
        transaction_id: Set(input.transaction_id),
        user_id: Set(actor.user_id),
        refund_type: Set(refund_type.to_string()),
        total_refund_amount: Set(total_refund_amount),
        total_exchange_amount: Set(Some(0.0)),
        difference_amount: Set(Some(0.0)),
        payment_method: Set(Some(transaction.payment_method.clone())),
        reason: Set(input.reason),
        created_at: Set(Some(now.clone())),
    };

    let refund = new_refund.insert(&txn).await?;

    // Create refund items and handle stock
    for item_input in &input.items {
        let (txn_item, product_id) = resolve_refund_line(&txn_items, item_input)?;

        let subtotal = refund_amount_for(txn_item, item_input.quantity);

        let new_refund_item = refund_items::ActiveModel {
            id: NotSet,
            refund_id: Set(refund.id),
            transaction_item_id: Set(item_input.transaction_item_id),
            product_id: Set(product_id),
            quantity: Set(item_input.quantity),
            subtotal: Set(subtotal),
            condition: Set(Some(item_input.condition.clone())),
            created_at: Set(Some(now.clone())),
        };

        let refund_item = new_refund_item.insert(&txn).await?;
        refund_items_result.push(refund_item);

        // Handle stock based on condition
        let product = products::Entity::find_by_id(product_id)
            .one(&txn)
            .await?
            .ok_or_else(|| AppError::NotFound("Produk tidak ditemukan".into()))?;

        if item_input.condition == "good" {
            // Atomically restore stock for good condition items
            txn.execute(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "UPDATE products SET stock = stock + $1, updated_at = $2 WHERE id = $3",
                vec![
                    (item_input.quantity as i64).into(),
                    now.clone().into(),
                    product_id.into(),
                ],
            ))
            .await?;
        } else {
            // Create stock write-off for damaged/expired items
            let writeoff_number = generate_writeoff_number(&txn).await?;

            let loss_value = product.buy_price * item_input.quantity as f64;

            let new_writeoff = stock_writeoffs::ActiveModel {
                id: NotSet,
                writeoff_number: Set(writeoff_number),
                product_id: Set(product_id),
                user_id: Set(actor.user_id),
                quantity: Set(item_input.quantity),
                reason: Set(item_input.condition.clone()),
                loss_value: Set(loss_value),
                notes: Set(Some(format!(
                    "Auto write-off dari refund {}",
                    refund.refund_number
                ))),
                approved_by: Set(None),
                status: Set("pending".to_string()),
                refund_id: Set(Some(refund.id)),
                created_at: Set(Some(now.clone())),
            };

            new_writeoff.insert(&txn).await?;
            // Stock is NOT restored for damaged/expired items (already sold, now written off)
        }
    }

    // Process exchange items if present
    let mut exchange_items_result: Vec<exchange_items::Model> = Vec::new();
    let mut total_exchange_amount: f64 = 0.0;

    if let Some(ref exchange_inputs) = input.exchange_items {
        // Read allow_negative_stock setting for exchange stock check
        let allow_negative_stock = store_info::Entity::find_by_id(1_i64)
            .one(&txn)
            .await?
            .map(|s| {
                parse_app_settings(&s.additional_info)
                    .sales
                    .allow_negative_stock
            })
            .unwrap_or(true);

        for ei_input in exchange_inputs {
            if ei_input.quantity <= 0 {
                return Err(AppError::Validation(
                    "Jumlah item tukar harus lebih dari 0".into(),
                ));
            }

            let product = products::Entity::find_by_id(ei_input.product_id)
                .one(&txn)
                .await?
                .ok_or_else(|| {
                    AppError::NotFound(format!(
                        "Produk exchange ID {} tidak ditemukan",
                        ei_input.product_id
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
            // concurrent refund/sale can slip a deduction in between, which
            // would otherwise let stock go negative when it isn't allowed.
            if !allow_negative_stock && product.stock < ei_input.quantity {
                return Err(AppError::Validation(format!(
                    "Stok '{}' tidak cukup (tersedia: {}, diminta: {})",
                    product.name, product.stock, ei_input.quantity
                )));
            }

            let exchange_subtotal = product.sell_price * ei_input.quantity as f64;
            total_exchange_amount += exchange_subtotal;

            let new_exchange_item = exchange_items::ActiveModel {
                id: NotSet,
                refund_id: Set(refund.id),
                product_id: Set(ei_input.product_id),
                product_name: Set(product.name.clone()),
                product_price: Set(product.sell_price),
                quantity: Set(ei_input.quantity),
                subtotal: Set(exchange_subtotal),
                created_at: Set(Some(now.clone())),
            };

            let exchange_item = new_exchange_item.insert(&txn).await?;
            exchange_items_result.push(exchange_item);

            // Atomically deduct stock for exchange item (like a sale)
            txn.execute(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "UPDATE products SET stock = stock - $1, updated_at = $2 WHERE id = $3",
                vec![
                    (ei_input.quantity as i64).into(),
                    now.clone().into(),
                    ei_input.product_id.into(),
                ],
            ))
            .await?;
        }
    }

    // Update refund with exchange amounts if applicable. Keep the updated model:
    // the previous code updated a clone and dropped the result, so every
    // exchange reported total_exchange_amount 0 and difference_amount 0 back to
    // the caller even though the database row was correct.
    let refund = if has_exchange {
        let difference_amount = total_refund_amount - total_exchange_amount;
        let mut active_refund: refunds::ActiveModel = refund.into();
        active_refund.total_exchange_amount = Set(Some(total_exchange_amount));
        active_refund.difference_amount = Set(Some(difference_amount));
        active_refund.update(&txn).await?
    } else {
        refund
    };

    // Determine transaction status: full or partial refund.
    //
    // Reuse the accumulated tally instead of matching the first input line per
    // item: a mixed-condition return sends the same transaction item twice (one
    // good, one damaged), and counting only the first line left a fully
    // refunded sale stuck at `partial_refund` forever -- where shift closing and
    // the reports keep counting it at full value.
    let total_refunded_qty: i64 = txn_items
        .iter()
        .map(|ti| {
            existing_refund_qty.get(&ti.id).copied().unwrap_or(0)
                + requested_in_this_refund.get(&ti.id).copied().unwrap_or(0)
        })
        .sum();

    let total_original_qty: i64 = txn_items.iter().map(|ti| ti.quantity).sum();

    let new_status = if total_refunded_qty >= total_original_qty {
        "refunded"
    } else {
        "partial_refund"
    };

    let mut active_txn: transactions::ActiveModel = transaction.into();
    active_txn.status = Set(new_status.to_string());
    active_txn.update(&txn).await?;

    txn.commit().await?;

    Ok(RefundResult {
        refund,
        items: refund_items_result,
        exchange_items: exchange_items_result,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::refunds::{ExchangeItemInput, RefundItemInput};
    use crate::test_support::{
        insert_product, insert_store_info, insert_transaction, insert_transaction_item,
        insert_transaction_item_spec, now_ts, setup_test_db, TransactionItemSpec,
    };

    /// The seeded admin (id 1). Refunds do not gate on role, so what matters
    /// here is only that the id is the actor's and not something the payload
    /// carried.
    fn actor() -> Actor {
        Actor::new(1, "admin")
    }

    /// In-memory database with the singleton store row seeded, so the exchange
    /// path can read `allow_negative_stock` instead of falling back to its
    /// permissive default.
    async fn setup() -> DatabaseConnection {
        let conn = setup_test_db().await;
        insert_store_info(&conn, false).await;
        conn
    }

    async fn sale(conn: &DatabaseConnection, total: f64) -> transactions::Model {
        insert_transaction(conn, 1, total, "completed", &now_ts()).await
    }

    async fn stock_of(conn: &DatabaseConnection, product_id: i64) -> i64 {
        products::Entity::find_by_id(product_id)
            .one(conn)
            .await
            .expect("product query")
            .expect("product exists")
            .stock
    }

    /// Builds the input the way the IPC layer does, from the JSON the client
    /// sends. Lets a test express a payload that the Rust struct no longer has
    /// a field for.
    fn refund_input(value: serde_json::Value) -> CreateRefundInput {
        serde_json::from_value(value).expect("refund input deserializes")
    }

    /// Builds a one-line sale aged `age` and returns the line to refund.
    async fn aged_sale(
        conn: &DatabaseConnection,
        age: chrono::Duration,
    ) -> (transactions::Model, transaction_items::Model) {
        let product = insert_product(conn, "Roti Tawar", 9_000.0, 14_000.0, 20).await;
        let created_at = (chrono::Utc::now() - age)
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
        let txn = insert_transaction(conn, 1, 14_000.0, "completed", &created_at).await;
        let item = insert_transaction_item(
            conn,
            txn.id,
            Some(product.id),
            "Roti Tawar",
            14_000.0,
            9_000.0,
            1,
        )
        .await;
        (txn, item)
    }

    fn refund_one(txn_id: i64, item_id: i64) -> CreateRefundInput {
        CreateRefundInput {
            transaction_id: txn_id,
            reason: None,
            items: vec![RefundItemInput {
                transaction_item_id: item_id,
                quantity: 1,
                condition: "good".to_string(),
            }],
            exchange_items: None,
        }
    }

    #[tokio::test]
    async fn exchange_returns_the_updated_amounts() {
        let conn = setup().await;

        let returned = insert_product(&conn, "Sarung", 40_000.0, 60_000.0, 10).await;
        let replacement = insert_product(&conn, "Peci", 25_000.0, 45_000.0, 10).await;
        let txn = sale(&conn, 60_000.0).await;
        let txn_item = insert_transaction_item(
            &conn,
            txn.id,
            Some(returned.id),
            "Sarung",
            60_000.0,
            40_000.0,
            1,
        )
        .await;

        let result = create(
            &conn,
            &actor(),
            CreateRefundInput {
                transaction_id: txn.id,
                reason: Some("Tukar model".to_string()),
                items: vec![RefundItemInput {
                    transaction_item_id: txn_item.id,
                    quantity: 1,
                    condition: "good".to_string(),
                }],
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
    }

    #[tokio::test]
    async fn refund_split_across_two_lines_closes_the_sale() {
        let conn = setup().await;

        let product = insert_product(&conn, "Piring", 6_000.0, 10_000.0, 20).await;
        let txn = sale(&conn, 20_000.0).await;
        let txn_item = insert_transaction_item(
            &conn,
            txn.id,
            Some(product.id),
            "Piring",
            10_000.0,
            6_000.0,
            2,
        )
        .await;

        // A legitimate mixed-condition return: both units come back, one intact
        // and one broken, so the customer sends two lines for the same item.
        create(
            &conn,
            &actor(),
            CreateRefundInput {
                transaction_id: txn.id,
                reason: Some("Satu pecah".to_string()),
                items: vec![
                    RefundItemInput {
                        transaction_item_id: txn_item.id,
                        quantity: 1,
                        condition: "good".to_string(),
                    },
                    RefundItemInput {
                        transaction_item_id: txn_item.id,
                        quantity: 1,
                        condition: "damaged".to_string(),
                    },
                ],
                exchange_items: None,
            },
        )
        .await
        .expect("refund should succeed");

        let updated_txn = transactions::Entity::find_by_id(txn.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("transaction exists");
        assert_eq!(updated_txn.status, "refunded");
    }

    #[tokio::test]
    async fn refund_rejects_a_sale_past_seven_days_by_an_hour() {
        let conn = setup().await;
        let (txn, item) = aged_sale(&conn, chrono::Duration::hours(7 * 24 + 1)).await;

        let result = create(&conn, &actor(), refund_one(txn.id, item.id)).await;

        match result {
            Err(AppError::Validation(msg)) => assert!(
                msg.contains("7"),
                "Error should mention the 7-day limit, got: {msg}"
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn refund_allows_a_sale_just_inside_seven_days() {
        let conn = setup().await;
        let (txn, item) = aged_sale(&conn, chrono::Duration::hours(7 * 24 - 1)).await;

        create(&conn, &actor(), refund_one(txn.id, item.id))
            .await
            .expect("refund inside the window should succeed");
    }

    #[tokio::test]
    async fn refund_rejects_a_sale_without_a_timestamp() {
        let conn = setup().await;
        let (txn, item) = aged_sale(&conn, chrono::Duration::zero()).await;

        let mut undated: transactions::ActiveModel = txn.clone().into();
        undated.created_at = Set(None);
        undated.update(&conn).await.expect("clear created_at");

        let result = create(&conn, &actor(), refund_one(txn.id, item.id)).await;

        match result {
            Err(AppError::Validation(msg)) => assert!(
                msg.contains("tanggal"),
                "Error should mention the missing date, got: {msg}"
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn refund_rejects_a_voided_transaction() {
        let conn = setup().await;

        let product = insert_product(&conn, "Teh Kotak", 4_000.0, 6_000.0, 20).await;
        let txn = sale(&conn, 6_000.0).await;
        let txn_item = insert_transaction_item(
            &conn,
            txn.id,
            Some(product.id),
            "Teh Kotak",
            6_000.0,
            4_000.0,
            1,
        )
        .await;

        // Exactly what delete_transaction leaves behind: stock already given
        // back, total zeroed, the void recorded.
        let mut voided: transactions::ActiveModel = txn.clone().into();
        voided.status = Set("deleted".to_string());
        voided.total_amount = Set(0.0);
        voided.deleted_at = Set(Some(now_ts()));
        voided.deleted_by = Set(Some(1));
        voided.deleted_reason = Set(Some("Salah input".to_string()));
        voided.update(&conn).await.expect("void transaction");

        let stock_before = stock_of(&conn, product.id).await;

        let result = create(
            &conn,
            &actor(),
            CreateRefundInput {
                transaction_id: txn.id,
                reason: None,
                items: vec![RefundItemInput {
                    transaction_item_id: txn_item.id,
                    quantity: 1,
                    condition: "good".to_string(),
                }],
                exchange_items: None,
            },
        )
        .await;

        match result {
            Err(AppError::Validation(msg)) => {
                assert!(
                    msg.contains("dibatalkan"),
                    "Error should say the sale was voided, got: {msg}"
                );
            }
            other => panic!("Expected Validation error, got: {:?}", other),
        }

        // No second stock restore, and the void is still recorded as a void.
        assert_eq!(stock_of(&conn, product.id).await, stock_before);
        let reloaded = transactions::Entity::find_by_id(txn.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("transaction exists");
        assert_eq!(reloaded.status, "deleted");
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

        let result = create(
            &conn,
            &actor(),
            CreateRefundInput {
                transaction_id: txn.id,
                reason: None,
                items: vec![RefundItemInput {
                    transaction_item_id: txn_item.id,
                    quantity: 1,
                    condition: "good".to_string(),
                }],
                exchange_items: None,
            },
        )
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
            CreateRefundInput {
                transaction_id: txn.id,
                reason: None,
                items: vec![RefundItemInput {
                    transaction_item_id: txn_item.id,
                    quantity: 2,
                    condition: "good".to_string(),
                }],
                exchange_items: None,
            },
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
    async fn test_refund_writeoff_status_is_pending() {
        let conn = setup().await;

        let product = insert_product(&conn, "Beras 5kg", 50_000.0, 65_000.0, 100).await;
        let txn = sale(&conn, 130_000.0).await;
        let txn_item = insert_transaction_item(
            &conn,
            txn.id,
            Some(product.id),
            "Beras 5kg",
            65_000.0,
            50_000.0,
            2,
        )
        .await;

        let result = create(
            &conn,
            &actor(),
            CreateRefundInput {
                transaction_id: txn.id,
                reason: Some("Barang rusak".to_string()),
                items: vec![RefundItemInput {
                    transaction_item_id: txn_item.id,
                    quantity: 1,
                    condition: "damaged".to_string(),
                }],
                exchange_items: None,
            },
        )
        .await
        .expect("refund should succeed");

        let writeoffs = stock_writeoffs::Entity::find()
            .filter(stock_writeoffs::Column::RefundId.eq(result.refund.id))
            .all(&conn)
            .await
            .expect("query writeoffs");

        assert_eq!(writeoffs.len(), 1);
        assert_eq!(writeoffs[0].status, "pending");
        assert_eq!(writeoffs[0].reason, "damaged");
        assert_eq!(writeoffs[0].quantity, 1);
        assert_eq!(writeoffs[0].loss_value, 50_000.0); // buy_price * quantity
        assert_eq!(writeoffs[0].product_id, product.id);
    }

    #[tokio::test]
    async fn test_refund_good_condition_restores_stock() {
        let conn = setup().await;

        let product = insert_product(&conn, "Gula Pasir", 10_000.0, 15_000.0, 50).await;
        let txn = sale(&conn, 30_000.0).await;
        let txn_item = insert_transaction_item(
            &conn,
            txn.id,
            Some(product.id),
            "Gula Pasir",
            15_000.0,
            10_000.0,
            2,
        )
        .await;

        create(
            &conn,
            &actor(),
            CreateRefundInput {
                transaction_id: txn.id,
                reason: Some("Salah beli".to_string()),
                items: vec![RefundItemInput {
                    transaction_item_id: txn_item.id,
                    quantity: 1,
                    condition: "good".to_string(),
                }],
                exchange_items: None,
            },
        )
        .await
        .expect("refund should succeed");

        // Stock should be restored: 50 + 1 = 51
        let updated_product = products::Entity::find_by_id(product.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("product exists");
        assert_eq!(updated_product.stock, 51);

        // No write-off should be created for good condition items
        let writeoffs = stock_writeoffs::Entity::find()
            .filter(stock_writeoffs::Column::ProductId.eq(product.id))
            .all(&conn)
            .await
            .expect("query writeoffs");
        assert_eq!(writeoffs.len(), 0);
    }

    #[tokio::test]
    async fn test_refund_expired_transaction_rejected() {
        let conn = setup().await;

        let product = insert_product(&conn, "Minyak Goreng", 15_000.0, 20_000.0, 30).await;

        // Sale dated 8 days ago, beyond the 7-day window.
        let old_date = (chrono::Utc::now() - chrono::Duration::days(8))
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
        let txn = insert_transaction(&conn, 1, 20_000.0, "completed", &old_date).await;

        let txn_item = insert_transaction_item(
            &conn,
            txn.id,
            Some(product.id),
            "Minyak Goreng",
            20_000.0,
            15_000.0,
            1,
        )
        .await;

        let result = create(
            &conn,
            &actor(),
            CreateRefundInput {
                transaction_id: txn.id,
                reason: Some("Mau kembalikan".to_string()),
                items: vec![RefundItemInput {
                    transaction_item_id: txn_item.id,
                    quantity: 1,
                    condition: "good".to_string(),
                }],
                exchange_items: None,
            },
        )
        .await;

        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => {
                assert!(msg.contains("7"), "Error should mention 7-day limit");
            }
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_refund_empty_items_rejected() {
        let conn = setup().await;

        let product = insert_product(&conn, "Tepung", 8_000.0, 12_000.0, 20).await;
        let txn = sale(&conn, 12_000.0).await;
        insert_transaction_item(
            &conn,
            txn.id,
            Some(product.id),
            "Tepung",
            12_000.0,
            8_000.0,
            1,
        )
        .await;

        let result = create(
            &conn,
            &actor(),
            CreateRefundInput {
                transaction_id: txn.id,
                reason: None,
                items: vec![], // empty items
                exchange_items: None,
            },
        )
        .await;

        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => {
                assert!(msg.contains("kosong"), "Error should mention empty items");
            }
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_refund_invalid_condition_rejected() {
        let conn = setup().await;

        let product = insert_product(&conn, "Sabun", 3_000.0, 5_000.0, 40).await;
        let txn = sale(&conn, 5_000.0).await;
        let txn_item = insert_transaction_item(
            &conn,
            txn.id,
            Some(product.id),
            "Sabun",
            5_000.0,
            3_000.0,
            1,
        )
        .await;

        let result = create(
            &conn,
            &actor(),
            CreateRefundInput {
                transaction_id: txn.id,
                reason: None,
                items: vec![RefundItemInput {
                    transaction_item_id: txn_item.id,
                    quantity: 1,
                    condition: "broken".to_string(), // invalid condition
                }],
                exchange_items: None,
            },
        )
        .await;

        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => {
                assert!(
                    msg.contains("tidak valid"),
                    "Error should mention invalid condition"
                );
            }
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_refund_sets_transaction_status_to_partial() {
        let conn = setup().await;

        let product = insert_product(&conn, "Kecap", 5_000.0, 8_000.0, 50).await;
        let txn = sale(&conn, 16_000.0).await;
        let txn_item = insert_transaction_item(
            &conn,
            txn.id,
            Some(product.id),
            "Kecap",
            8_000.0,
            5_000.0,
            2,
        )
        .await;

        // Refund only 1 of 2 items -> partial_refund
        create(
            &conn,
            &actor(),
            CreateRefundInput {
                transaction_id: txn.id,
                reason: None,
                items: vec![RefundItemInput {
                    transaction_item_id: txn_item.id,
                    quantity: 1,
                    condition: "good".to_string(),
                }],
                exchange_items: None,
            },
        )
        .await
        .expect("refund should succeed");

        let updated_txn = transactions::Entity::find_by_id(txn.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("transaction exists");
        assert_eq!(updated_txn.status, "partial_refund");
    }

    #[tokio::test]
    async fn test_full_refund_sets_transaction_status_to_refunded() {
        let conn = setup().await;

        let product = insert_product(&conn, "Sambal", 7_000.0, 10_000.0, 30).await;
        let txn = sale(&conn, 10_000.0).await;
        let txn_item = insert_transaction_item(
            &conn,
            txn.id,
            Some(product.id),
            "Sambal",
            10_000.0,
            7_000.0,
            1,
        )
        .await;

        // Refund all items -> refunded
        create(
            &conn,
            &actor(),
            CreateRefundInput {
                transaction_id: txn.id,
                reason: None,
                items: vec![RefundItemInput {
                    transaction_item_id: txn_item.id,
                    quantity: 1,
                    condition: "good".to_string(),
                }],
                exchange_items: None,
            },
        )
        .await
        .expect("refund should succeed");

        let updated_txn = transactions::Entity::find_by_id(txn.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("transaction exists");
        assert_eq!(updated_txn.status, "refunded");
    }
}

//! Creating, editing and soft-deleting a single product.

use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, ConnectionTrait, DatabaseConnection,
    EntityTrait, QueryFilter, Set, TransactionTrait,
};

use crate::domain::products::{CreateProductInput, UpdateProductInput};
use crate::domain::Actor;
use crate::entity::products;
use crate::services::transactions::load_allow_negative_stock;
use crate::services::{categories, guard};
use crate::utils::time::now_ts;
use crate::utils::AppError;

/// Price and stock rules shared by create and update.
pub(super) fn validate_product_fields(
    name: &str,
    sell_price: f64,
    buy_price: f64,
    stock: i64,
) -> Result<String, AppError> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation(
            "Nama produk tidak boleh kosong".to_string(),
        ));
    }
    if sell_price <= 0.0 {
        return Err(AppError::Validation(
            "Harga jual harus lebih dari 0".to_string(),
        ));
    }
    if buy_price < 0.0 {
        return Err(AppError::Validation(
            "Harga beli tidak boleh negatif".to_string(),
        ));
    }
    if stock < 0 {
        return Err(AppError::Validation("Stok tidak boleh negatif".to_string()));
    }
    Ok(name)
}

/// Trims a barcode or SKU and treats a blank one as absent.
///
/// `barcode` and `sku` are UNIQUE columns, and SQLite counts `''` as a value
/// like any other while it lets NULLs repeat freely. Storing the empty string
/// therefore meant the SECOND product saved without a barcode collided with the
/// first.
pub(super) fn normalize_code(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Makes `barcode` and `sku` available to the product being written, or explains
/// who has them.
///
/// A live product holding the code is a genuine clash and the caller gets a
/// `Validation` error naming it, instead of the bare
/// `UNIQUE constraint failed: products.barcode` the UI had no way to interpret.
///
/// A SOFT-DELETED product holding it is not a clash at all — the row only still
/// exists so old receipts keep resolving — but it kept the code hostage
/// forever: delete a product and it became impossible to create it again, from
/// any screen, with no way out. The rule is that a deleted product never blocks
/// a live one, so the code is released from it (set to NULL) and the caller
/// proceeds. The deleted row keeps everything history depends on; its name and
/// price are snapshotted onto `transaction_items` anyway, and nothing looks a
/// deleted product up by barcode.
///
/// `exclude_id` is the product being updated, which is allowed to keep its own
/// codes.
async fn claim_codes<C: ConnectionTrait>(
    db: &C,
    barcode: Option<&str>,
    sku: Option<&str>,
    exclude_id: Option<i64>,
) -> Result<(), AppError> {
    for (label, is_barcode, value) in [("Barcode", true, barcode), ("SKU", false, sku)] {
        let Some(value) = value else { continue };

        let column = if is_barcode {
            products::Column::Barcode
        } else {
            products::Column::Sku
        };

        let mut query = products::Entity::find().filter(column.eq(value));
        if let Some(id) = exclude_id {
            query = query.filter(products::Column::Id.ne(id));
        }
        let Some(holder) = query.one(db).await? else {
            continue;
        };

        if holder.is_active {
            return Err(AppError::Validation(format!(
                "{} '{}' sudah dipakai produk '{}'",
                label, value, holder.name
            )));
        }

        let mut released: products::ActiveModel = holder.into();
        if is_barcode {
            released.barcode = Set(None);
        } else {
            released.sku = Set(None);
        }
        released.updated_at = Set(Some(now_ts()));
        released.update(db).await?;
    }

    Ok(())
}

pub async fn create(
    db: &DatabaseConnection,
    actor: &Actor,
    input: CreateProductInput,
) -> Result<products::Model, AppError> {
    guard::require_admin(actor)?;

    let name =
        validate_product_fields(&input.name, input.sell_price, input.buy_price, input.stock)?;
    let barcode = normalize_code(input.barcode);
    let sku = normalize_code(input.sku);

    let now = now_ts();

    // Releasing a dead product's code and taking it must be one unit of work,
    // or a failure in between would leave the catalogue with the code freed and
    // nothing holding it.
    let txn = db.begin().await?;
    categories::ensure_exists(&txn, input.category_id).await?;
    claim_codes(&txn, barcode.as_deref(), sku.as_deref(), None).await?;

    let new_product = products::ActiveModel {
        id: NotSet,
        barcode: Set(barcode),
        sku: Set(sku),
        name: Set(name),
        category_id: Set(input.category_id),
        buy_price: Set(input.buy_price),
        sell_price: Set(input.sell_price),
        margin: Set(input.margin.unwrap_or(0.0)),
        stock: Set(input.stock),
        unit: Set(input.unit),
        min_stock: Set(Some(input.min_stock.unwrap_or(0))),
        is_active: Set(true),
        created_at: Set(Some(now.clone())),
        updated_at: Set(Some(now)),
    };

    let product = new_product.insert(&txn).await?;
    txn.commit().await?;
    Ok(product)
}

pub async fn update(
    db: &DatabaseConnection,
    actor: &Actor,
    input: UpdateProductInput,
) -> Result<products::Model, AppError> {
    guard::require_admin(actor)?;

    let name = validate_product_fields(
        &input.name,
        input.sell_price,
        input.buy_price,
        input.stock.unwrap_or(0),
    )?;
    let barcode = normalize_code(input.barcode);
    let sku = normalize_code(input.sku);

    let txn = db.begin().await?;

    let existing = products::Entity::find_by_id(input.id)
        .filter(products::Column::IsActive.eq(true))
        .one(&txn)
        .await?
        .ok_or_else(|| AppError::NotFound("Produk tidak ditemukan".to_string()))?;

    categories::ensure_exists(&txn, input.category_id).await?;
    claim_codes(&txn, barcode.as_deref(), sku.as_deref(), Some(existing.id)).await?;

    // A delta goes through `stock = stock + ?` rather than a value computed
    // from `existing`, so it lands on whatever the row holds at write time.
    if let (Some(stock), Some(expected)) = (input.stock, input.expected_stock) {
        let delta = stock - expected;
        if delta != 0 {
            products::Entity::update_many()
                .col_expr(
                    products::Column::Stock,
                    Expr::col(products::Column::Stock).add(delta),
                )
                .filter(products::Column::Id.eq(existing.id))
                .exec(&txn)
                .await?;
            let applied = products::Entity::find_by_id(existing.id)
                .one(&txn)
                .await?
                .map(|p| p.stock)
                .unwrap_or_default();
            // A delta on top of sales made meanwhile can end below zero; that
            // is refused unless the store allows negative stock, the same
            // setting checkout and exchanges go by.
            if applied < 0 && !load_allow_negative_stock(&txn).await? {
                return Err(AppError::Validation(format!(
                    "Stok tidak boleh negatif: stok sekarang {} setelah penjualan terbaru, \
                     perubahan {:+} menjadikannya {}",
                    applied - delta,
                    delta,
                    applied
                )));
            }
        }
    }

    let mut active: products::ActiveModel = existing.into();
    active.barcode = Set(barcode);
    active.sku = Set(sku);
    active.name = Set(name);
    active.category_id = Set(input.category_id);
    active.buy_price = Set(input.buy_price);
    active.sell_price = Set(input.sell_price);
    active.margin = Set(input.margin.unwrap_or(0.0));
    // Only the absolute fallback writes the column; otherwise it stays
    // `Unchanged` and the UPDATE below does not touch it.
    if let (Some(stock), None) = (input.stock, input.expected_stock) {
        active.stock = Set(stock);
    }
    active.unit = Set(input.unit);
    active.min_stock = Set(Some(input.min_stock.unwrap_or(0)));
    active.updated_at = Set(Some(now_ts()));

    let product = active.update(&txn).await?;
    txn.commit().await?;
    Ok(product)
}

/// Soft delete: the row stays for transaction history, `is_active` goes false.
pub async fn delete(db: &DatabaseConnection, actor: &Actor, id: i64) -> Result<(), AppError> {
    guard::require_admin(actor)?;

    let existing = products::Entity::find_by_id(id)
        .filter(products::Column::IsActive.eq(true))
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Produk tidak ditemukan".to_string()))?;

    let mut active: products::ActiveModel = existing.into();
    active.is_active = Set(false);
    active.updated_at = Set(Some(now_ts()));
    active.update(db).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::products::test_fixtures::{admin, make_valid_input};
    use crate::test_support::setup_test_db;

    fn assert_unknown_category<T: std::fmt::Debug>(result: Result<T, AppError>) {
        match result {
            Err(AppError::Validation(message)) => {
                assert_eq!(message, "Kategori tidak ditemukan")
            }
            other => panic!("expected a Validation error, got {:?}", other),
        }
    }

    /// A category id that no longer exists (deleted in another window) used to
    /// reach the admin as a bare `FOREIGN KEY constraint failed`.
    #[tokio::test]
    async fn creating_a_product_in_a_missing_category_is_a_validation_error() {
        let conn = setup_test_db().await;
        let input = CreateProductInput {
            category_id: Some(999),
            ..make_valid_input()
        };

        assert_unknown_category(create(&conn, &admin(), input).await);
        assert!(products::Entity::find()
            .all(&conn)
            .await
            .expect("query")
            .is_empty());
    }

    #[tokio::test]
    async fn moving_a_product_to_a_missing_category_is_a_validation_error() {
        let conn = setup_test_db().await;
        let product = create(&conn, &admin(), make_valid_input())
            .await
            .expect("product");

        let result = update(
            &conn,
            &admin(),
            UpdateProductInput {
                id: product.id,
                barcode: product.barcode.clone(),
                sku: product.sku.clone(),
                name: product.name.clone(),
                category_id: Some(999),
                buy_price: product.buy_price,
                sell_price: product.sell_price,
                margin: None,
                stock: Some(product.stock),
                expected_stock: None,
                unit: product.unit.clone(),
                min_stock: None,
            },
        )
        .await;

        assert_unknown_category(result);
        let unchanged = products::Entity::find_by_id(product.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("row");
        assert_eq!(unchanged.category_id, None);
    }

    #[tokio::test]
    async fn test_create_product_success() {
        let conn = setup_test_db().await;
        let input = make_valid_input();

        let product = create(&conn, &admin(), input)
            .await
            .expect("create should succeed");

        assert_eq!(product.name, "Beras 5kg");
        assert_eq!(product.sell_price, 65_000.0);
        assert_eq!(product.buy_price, 50_000.0);
        assert_eq!(product.stock, 100);
        assert!(product.is_active);
        assert_eq!(product.barcode, Some("1234567890123".to_string()));
        assert_eq!(product.sku, Some("SKU-001".to_string()));
        assert_eq!(product.unit, "pcs");
        assert_eq!(product.min_stock, Some(10));
    }

    #[tokio::test]
    async fn test_create_product_empty_name_fails() {
        let conn = setup_test_db().await;
        let mut input = make_valid_input();
        input.name = "   ".to_string();

        let result = create(&conn, &admin(), input).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("kosong")),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_create_product_zero_sell_price_fails() {
        let conn = setup_test_db().await;
        let mut input = make_valid_input();
        input.sell_price = 0.0;

        let result = create(&conn, &admin(), input).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("Harga jual")),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_create_product_negative_sell_price_fails() {
        let conn = setup_test_db().await;
        let mut input = make_valid_input();
        input.sell_price = -100.0;

        let result = create(&conn, &admin(), input).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("Harga jual")),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_create_product_negative_buy_price_fails() {
        let conn = setup_test_db().await;
        let mut input = make_valid_input();
        input.buy_price = -1.0;

        let result = create(&conn, &admin(), input).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("negatif")),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_create_product_negative_stock_fails() {
        let conn = setup_test_db().await;
        let mut input = make_valid_input();
        input.stock = -5;

        let result = create(&conn, &admin(), input).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("Stok")),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_create_product_trims_name() {
        let conn = setup_test_db().await;
        let mut input = make_valid_input();
        input.name = "  Gula Pasir 1kg  ".to_string();
        input.barcode = None;
        input.sku = None;

        let product = create(&conn, &admin(), input)
            .await
            .expect("create should succeed");

        assert_eq!(product.name, "Gula Pasir 1kg");
    }

    #[tokio::test]
    async fn test_create_product_kasir_rejected() {
        let conn = setup_test_db().await;

        let input = make_valid_input();
        let result = create(&conn, &Actor::new(2, "kasir"), input).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Forbidden(_) => {} // expected — kasir cannot create products
            other => panic!("Expected Forbidden error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_delete_product_soft_deletes() {
        let conn = setup_test_db().await;
        let input = make_valid_input();

        let product = create(&conn, &admin(), input)
            .await
            .expect("create should succeed");
        assert!(product.is_active);

        delete(&conn, &admin(), product.id)
            .await
            .expect("delete should succeed");

        // Product still exists in DB but is_active = false
        let deleted = products::Entity::find_by_id(product.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("product should still exist in DB");

        assert!(!deleted.is_active);
    }

    #[tokio::test]
    async fn test_delete_nonexistent_product_fails() {
        let conn = setup_test_db().await;

        let result = delete(&conn, &admin(), 999).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::NotFound(_) => {} // expected
            other => panic!("Expected NotFound error, got: {:?}", other),
        }
    }

    // --- Barcode and SKU uniqueness ---

    /// A live product holding the code is a real clash, and the message has to
    /// name it. The UI used to be handed
    /// `UNIQUE constraint failed: products.barcode` with nothing to do about it.
    #[tokio::test]
    async fn a_barcode_a_live_product_holds_is_a_validation_error() {
        let conn = setup_test_db().await;
        create(&conn, &admin(), make_valid_input())
            .await
            .expect("first product");

        let mut second = make_valid_input();
        second.name = "Beras 10kg".to_string();
        second.sku = Some("SKU-002".to_string());

        match create(&conn, &admin(), second).await.unwrap_err() {
            AppError::Validation(msg) => {
                assert!(msg.contains("1234567890123"), "names the code: {}", msg);
                assert!(msg.contains("Beras 5kg"), "names the holder: {}", msg);
            }
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn a_sku_a_live_product_holds_is_a_validation_error() {
        let conn = setup_test_db().await;
        create(&conn, &admin(), make_valid_input())
            .await
            .expect("first product");

        let mut second = make_valid_input();
        second.name = "Beras 10kg".to_string();
        second.barcode = Some("9999999999999".to_string());

        match create(&conn, &admin(), second).await.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("SKU-001"), "{}", msg),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    /// Deleting a product used to take its barcode to the grave: recreating it
    /// was impossible from any screen. A soft-deleted row never blocks a live
    /// one — the code is released and the new product takes it.
    #[tokio::test]
    async fn a_deleted_products_barcode_can_be_used_again() {
        let conn = setup_test_db().await;
        let first = create(&conn, &admin(), make_valid_input())
            .await
            .expect("first product");
        delete(&conn, &admin(), first.id)
            .await
            .expect("soft delete");

        let recreated = create(&conn, &admin(), make_valid_input())
            .await
            .expect("the barcode is free again");

        assert_eq!(recreated.barcode, Some("1234567890123".to_string()));
        assert_eq!(recreated.sku, Some("SKU-001".to_string()));

        let released = products::Entity::find_by_id(first.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("the deleted row is still there for history");
        assert!(!released.is_active);
        assert_eq!(released.barcode, None);
        assert_eq!(released.sku, None);
    }

    #[tokio::test]
    async fn update_cannot_steal_a_live_products_barcode_but_can_take_a_dead_ones() {
        let conn = setup_test_db().await;
        let first = create(&conn, &admin(), make_valid_input())
            .await
            .expect("first product");

        let mut second_input = make_valid_input();
        second_input.name = "Gula 1kg".to_string();
        second_input.barcode = Some("2222222222222".to_string());
        second_input.sku = Some("SKU-002".to_string());
        let second = create(&conn, &admin(), second_input)
            .await
            .expect("second product");

        let take_it = |barcode: &str| UpdateProductInput {
            id: second.id,
            barcode: Some(barcode.to_string()),
            sku: Some("SKU-002".to_string()),
            name: "Gula 1kg".to_string(),
            category_id: None,
            buy_price: 10_000.0,
            sell_price: 12_000.0,
            margin: None,
            stock: Some(5),
            expected_stock: None,
            unit: "pcs".to_string(),
            min_stock: None,
        };

        match update(&conn, &admin(), take_it("1234567890123"))
            .await
            .unwrap_err()
        {
            AppError::Validation(msg) => assert!(msg.contains("Beras 5kg"), "{}", msg),
            other => panic!("Expected Validation error, got: {:?}", other),
        }

        delete(&conn, &admin(), first.id)
            .await
            .expect("soft delete");

        let updated = update(&conn, &admin(), take_it("1234567890123"))
            .await
            .expect("a deleted product does not hold a barcode hostage");
        assert_eq!(updated.barcode, Some("1234567890123".to_string()));
    }

    /// A product may keep the codes it already has.
    #[tokio::test]
    async fn update_leaves_a_product_its_own_codes() {
        let conn = setup_test_db().await;
        let product = create(&conn, &admin(), make_valid_input())
            .await
            .expect("product");

        let updated = update(
            &conn,
            &admin(),
            UpdateProductInput {
                id: product.id,
                barcode: product.barcode.clone(),
                sku: product.sku.clone(),
                name: "Beras 5kg Premium".to_string(),
                category_id: None,
                buy_price: 50_000.0,
                sell_price: 70_000.0,
                margin: None,
                stock: Some(100),
                expected_stock: None,
                unit: "pcs".to_string(),
                min_stock: Some(10),
            },
        )
        .await
        .expect("update");

        assert_eq!(updated.name, "Beras 5kg Premium");
        assert_eq!(updated.barcode, product.barcode);
    }

    // --- Stock on update ---

    /// What the edit form sends for `product` with only the price changed.
    fn edit_of(product: &products::Model) -> UpdateProductInput {
        UpdateProductInput {
            id: product.id,
            barcode: product.barcode.clone(),
            sku: product.sku.clone(),
            name: product.name.clone(),
            category_id: product.category_id,
            buy_price: product.buy_price,
            sell_price: 70_000.0,
            margin: None,
            stock: None,
            expected_stock: None,
            unit: product.unit.clone(),
            min_stock: product.min_stock,
        }
    }

    /// A sale landing while the edit form is open, the way checkout writes it.
    async fn sell(conn: &DatabaseConnection, product_id: i64, quantity: i64) {
        products::Entity::update_many()
            .col_expr(
                products::Column::Stock,
                Expr::col(products::Column::Stock).sub(quantity),
            )
            .filter(products::Column::Id.eq(product_id))
            .exec(conn)
            .await
            .expect("sale");
    }

    /// The bug: the form sent back the stock it loaded, so a price edit
    /// silently undid every sale made while it was open.
    #[tokio::test]
    async fn an_update_without_stock_keeps_a_sale_made_meanwhile() {
        let conn = setup_test_db().await;
        let product = create(&conn, &admin(), make_valid_input())
            .await
            .expect("product");
        sell(&conn, product.id, 3).await;

        let updated = update(&conn, &admin(), edit_of(&product))
            .await
            .expect("update");

        assert_eq!(updated.sell_price, 70_000.0);
        assert_eq!(updated.stock, 97);
    }

    /// Loaded 100, admin typed 110 (+10 restock), 3 sold meanwhile: 107.
    #[tokio::test]
    async fn a_stock_edit_is_applied_as_a_delta_on_top_of_a_concurrent_sale() {
        let conn = setup_test_db().await;
        let product = create(&conn, &admin(), make_valid_input())
            .await
            .expect("product");
        sell(&conn, product.id, 3).await;

        let updated = update(
            &conn,
            &admin(),
            UpdateProductInput {
                stock: Some(110),
                expected_stock: Some(100),
                ..edit_of(&product)
            },
        )
        .await
        .expect("update");

        assert_eq!(updated.stock, 107);
    }

    /// With negative stock off, a delta that would take stock below zero is
    /// refused and nothing of the edit is written.
    #[tokio::test]
    async fn a_delta_that_would_go_negative_is_rejected_when_negative_stock_is_off() {
        let conn = setup_test_db().await;
        crate::test_support::insert_store_info(&conn, false).await;
        let product = create(&conn, &admin(), make_valid_input())
            .await
            .expect("product");
        sell(&conn, product.id, 95).await;

        match update(
            &conn,
            &admin(),
            UpdateProductInput {
                stock: Some(10),
                expected_stock: Some(100),
                ..edit_of(&product)
            },
        )
        .await
        .unwrap_err()
        {
            AppError::Validation(msg) => assert!(msg.contains("Stok"), "{}", msg),
            other => panic!("Expected Validation error, got: {:?}", other),
        }

        let unchanged = products::Entity::find_by_id(product.id)
            .one(&conn)
            .await
            .expect("query")
            .expect("row");
        assert_eq!(unchanged.stock, 5);
        assert_eq!(unchanged.sell_price, 65_000.0);
    }

    /// With negative stock on, the same delta goes through, as a sale would.
    #[tokio::test]
    async fn a_delta_may_go_negative_when_negative_stock_is_allowed() {
        let conn = setup_test_db().await;
        crate::test_support::insert_store_info(&conn, true).await;
        let product = create(&conn, &admin(), make_valid_input())
            .await
            .expect("product");
        sell(&conn, product.id, 95).await;

        let updated = update(
            &conn,
            &admin(),
            UpdateProductInput {
                stock: Some(10),
                expected_stock: Some(100),
                ..edit_of(&product)
            },
        )
        .await
        .expect("update");

        assert_eq!(updated.stock, -85);
        assert_eq!(updated.sell_price, 70_000.0);
    }

    /// Older clients send `stock` alone: it is still
    /// written as is.
    #[tokio::test]
    async fn stock_without_expected_stock_is_still_set_absolutely() {
        let conn = setup_test_db().await;
        let product = create(&conn, &admin(), make_valid_input())
            .await
            .expect("product");
        sell(&conn, product.id, 3).await;

        let updated = update(
            &conn,
            &admin(),
            UpdateProductInput {
                stock: Some(42),
                ..edit_of(&product)
            },
        )
        .await
        .expect("update");

        assert_eq!(updated.stock, 42);
    }

    /// `''` is a value as far as a UNIQUE index is concerned, so a blank code
    /// has to become NULL or the second product saved without one collides with
    /// the first.
    #[tokio::test]
    async fn a_blank_barcode_is_stored_as_null() {
        let conn = setup_test_db().await;

        for name in ["Beras Curah", "Gula Curah"] {
            let mut input = make_valid_input();
            input.name = name.to_string();
            input.barcode = Some("   ".to_string());
            input.sku = Some(String::new());
            let product = create(&conn, &admin(), input)
                .await
                .unwrap_or_else(|e| panic!("'{}' saves without a code: {:?}", name, e));
            assert_eq!(product.barcode, None);
            assert_eq!(product.sku, None);
        }
    }

    #[tokio::test]
    async fn test_delete_already_deleted_product_fails() {
        let conn = setup_test_db().await;
        let input = make_valid_input();

        let product = create(&conn, &admin(), input)
            .await
            .expect("create should succeed");

        delete(&conn, &admin(), product.id)
            .await
            .expect("first delete should succeed");

        // Second delete should fail — product is already inactive
        let result = delete(&conn, &admin(), product.id).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::NotFound(_) => {} // expected — already soft-deleted
            other => panic!("Expected NotFound error, got: {:?}", other),
        }
    }
}

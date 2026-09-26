//! Category CRUD.

use sea_orm::sea_query::{Expr, SimpleExpr};
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, ConnectionTrait, DatabaseConnection,
    EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, Set, TransactionTrait,
};

use crate::domain::categories::{CreateCategoryInput, UpdateCategoryInput};
use crate::domain::Actor;
use crate::entity::{categories, products};
use crate::services::guard;
use crate::utils::time::now_ts;
use crate::utils::AppError;

pub async fn list(db: &DatabaseConnection) -> Result<Vec<categories::Model>, AppError> {
    let cats = categories::Entity::find()
        .order_by_asc(categories::Column::Name)
        .all(db)
        .await?;
    Ok(cats)
}

fn validate_name(name: &str) -> Result<String, AppError> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation(
            "Nama kategori tidak boleh kosong".to_string(),
        ));
    }
    Ok(name)
}

/// The form two category names are compared in: trimmed, and lowercased the
/// way SQLite's `LOWER` does it (ASCII only), so a key computed here agrees
/// with [`same_name`] in SQL. The import keys its per-batch cache on this.
pub(crate) fn name_key(name: &str) -> String {
    name.trim().to_ascii_lowercase()
}

/// Matches the categories whose name has the same [`name_key`] as `name`.
fn same_name(name: &str) -> SimpleExpr {
    Expr::cust_with_values("LOWER(TRIM(name)) = ?", [name_key(name)])
}

/// The category called `name`, compared case-insensitively after trimming both
/// sides, so "minuman " in a spreadsheet finds the "Minuman" the catalogue
/// already has. The lowest id wins if the catalogue holds two names that only
/// differ in case.
pub(crate) async fn find_by_name<C: ConnectionTrait>(
    db: &C,
    name: &str,
) -> Result<Option<categories::Model>, AppError> {
    Ok(categories::Entity::find()
        .filter(same_name(name))
        .order_by_asc(categories::Column::Id)
        .one(db)
        .await?)
}

/// Checks that a product's `category_id`, if it has one, names a category that
/// exists. Left to the foreign key, a stale id (a category deleted in another
/// window) reached the admin as a bare `FOREIGN KEY constraint failed`.
pub(crate) async fn ensure_exists<C: ConnectionTrait>(
    db: &C,
    category_id: Option<i64>,
) -> Result<(), AppError> {
    let Some(id) = category_id else {
        return Ok(());
    };
    if categories::Entity::find_by_id(id).one(db).await?.is_none() {
        return Err(AppError::Validation("Kategori tidak ditemukan".to_string()));
    }
    Ok(())
}

/// `categories.name` is UNIQUE, and a clash left to the constraint reaches the
/// admin as a generic server error. `exclude_id` is the category being renamed,
/// which may keep its own name (or change only its case).
///
/// Compared the way the import matches ([`same_name`]): the constraint is
/// case-sensitive, so "minuman" next to "Minuman" used to be accepted, and the
/// import then filed every row under whichever of the two had the lower id.
async fn ensure_name_free(
    db: &DatabaseConnection,
    name: &str,
    exclude_id: Option<i64>,
) -> Result<(), AppError> {
    let mut query = categories::Entity::find().filter(same_name(name));
    if let Some(id) = exclude_id {
        query = query.filter(categories::Column::Id.ne(id));
    }
    if query.one(db).await?.is_some() {
        return Err(AppError::Validation(format!(
            "Kategori '{}' sudah ada",
            name
        )));
    }
    Ok(())
}

pub async fn create(
    db: &DatabaseConnection,
    actor: &Actor,
    input: CreateCategoryInput,
) -> Result<categories::Model, AppError> {
    guard::require_admin(actor)?;

    let name = validate_name(&input.name)?;
    ensure_name_free(db, &name, None).await?;

    let new_cat = categories::ActiveModel {
        id: NotSet,
        name: Set(name),
        description: Set(input.description),
        created_at: Set(Some(now_ts())),
    };

    let result = new_cat.insert(db).await?;
    Ok(result)
}

pub async fn update(
    db: &DatabaseConnection,
    actor: &Actor,
    input: UpdateCategoryInput,
) -> Result<categories::Model, AppError> {
    guard::require_admin(actor)?;

    let name = validate_name(&input.name)?;

    let existing = categories::Entity::find_by_id(input.id)
        .one(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Kategori tidak ditemukan".to_string()))?;
    ensure_name_free(db, &name, Some(existing.id)).await?;

    let mut active: categories::ActiveModel = existing.into();
    active.name = Set(name);
    active.description = Set(input.description);

    let result = active.update(db).await?;
    Ok(result)
}

/// Remove a category, provided nothing live still sits in it.
///
/// The check counts only ACTIVE products, which is the right question to put to
/// the user — but the foreign key does not care about `is_active`, so a category
/// that only soft-deleted products referenced passed the check and then died on
/// a raw `FOREIGN KEY constraint failed`. That category could never be deleted
/// by any route the UI offered. The deleted products are detached from it first
/// so the delete can go through; they keep their name and price snapshots on
/// `transaction_items`, and a category is not part of any history.
pub async fn delete(db: &DatabaseConnection, actor: &Actor, id: i64) -> Result<(), AppError> {
    guard::require_admin(actor)?;

    let count = products::Entity::find()
        .filter(products::Column::CategoryId.eq(id))
        .filter(products::Column::IsActive.eq(true))
        .count(db)
        .await?;

    if count > 0 {
        return Err(AppError::Validation(format!(
            "Kategori tidak dapat dihapus karena masih digunakan oleh {} produk",
            count
        )));
    }

    let txn = db.begin().await?;

    products::Entity::update_many()
        .col_expr(
            products::Column::CategoryId,
            Expr::value(Option::<i64>::None),
        )
        .filter(products::Column::CategoryId.eq(id))
        .exec(&txn)
        .await?;

    let result = categories::Entity::delete_by_id(id).exec(&txn).await?;

    if result.rows_affected == 0 {
        return Err(AppError::NotFound("Kategori tidak ditemukan".to_string()));
    }

    txn.commit().await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::products::CreateProductInput;
    use crate::services::products;
    use crate::test_support::setup_test_db;

    fn admin() -> Actor {
        Actor::new(1, "admin")
    }

    /// One category with one live product in it. Returns their ids.
    async fn seed(conn: &DatabaseConnection) -> (i64, i64) {
        let category = create(
            conn,
            &admin(),
            CreateCategoryInput {
                name: "Sembako".to_string(),
                description: None,
            },
        )
        .await
        .expect("category");

        let product = products::create(
            conn,
            &admin(),
            CreateProductInput {
                barcode: None,
                sku: None,
                name: "Beras 5kg".to_string(),
                category_id: Some(category.id),
                buy_price: 50_000.0,
                sell_price: 65_000.0,
                margin: None,
                stock: 10,
                unit: "pcs".to_string(),
                min_stock: None,
            },
        )
        .await
        .expect("product");

        (category.id, product.id)
    }

    #[tokio::test]
    async fn a_category_a_live_product_still_uses_cannot_be_removed() {
        let conn = setup_test_db().await;
        let (category_id, _) = seed(&conn).await;

        match delete(&conn, &admin(), category_id).await.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("1 produk"), "{}", msg),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    /// Only soft-deleted products referenced it, so the friendly count said zero
    /// and the DELETE then hit the foreign key those rows still hold. The
    /// category was unremovable by any route the UI offered.
    #[tokio::test]
    async fn a_category_only_deleted_products_reference_can_be_removed() {
        let conn = setup_test_db().await;
        let (category_id, product_id) = seed(&conn).await;
        products::delete(&conn, &admin(), product_id)
            .await
            .expect("soft delete");

        delete(&conn, &admin(), category_id)
            .await
            .expect("the deleted product does not keep the category alive");

        assert!(categories::Entity::find_by_id(category_id)
            .one(&conn)
            .await
            .expect("query")
            .is_none());

        let detached = crate::entity::products::Entity::find_by_id(product_id)
            .one(&conn)
            .await
            .expect("query")
            .expect("the row stays for history");
        assert_eq!(detached.category_id, None);
    }

    /// A duplicate name used to fall through to the UNIQUE constraint and reach
    /// the admin as a 500.
    #[tokio::test]
    async fn a_duplicate_category_name_is_a_validation_error() {
        let conn = setup_test_db().await;
        let (category_id, _) = seed(&conn).await;

        let dup = create(
            &conn,
            &admin(),
            CreateCategoryInput {
                name: " Sembako ".to_string(),
                description: None,
            },
        )
        .await;
        match dup.unwrap_err() {
            AppError::Validation(msg) => assert!(msg.contains("sudah ada"), "{}", msg),
            other => panic!("Expected Validation error, got: {:?}", other),
        }

        let other = create(
            &conn,
            &admin(),
            CreateCategoryInput {
                name: "Minuman".to_string(),
                description: None,
            },
        )
        .await
        .expect("second category");
        let renamed = update(
            &conn,
            &admin(),
            UpdateCategoryInput {
                id: other.id,
                name: "Sembako".to_string(),
                description: None,
            },
        )
        .await;
        assert!(matches!(renamed, Err(AppError::Validation(_))));

        // Keeping its own name is not a clash.
        update(
            &conn,
            &admin(),
            UpdateCategoryInput {
                id: category_id,
                name: "Sembako".to_string(),
                description: Some("Kebutuhan pokok".to_string()),
            },
        )
        .await
        .expect("a category may keep its own name");
    }

    /// The UNIQUE constraint is case-sensitive, so "sembako" beside "Sembako"
    /// used to be accepted; the import, which matches names case-insensitively,
    /// then filed every row under just one of them.
    #[tokio::test]
    async fn a_name_differing_only_in_case_or_spacing_is_a_duplicate() {
        let conn = setup_test_db().await;
        let (category_id, _) = seed(&conn).await;

        for clash in ["sembako", "  SEMBAKO  "] {
            let dup = create(
                &conn,
                &admin(),
                CreateCategoryInput {
                    name: clash.to_string(),
                    description: None,
                },
            )
            .await;
            assert!(
                matches!(dup, Err(AppError::Validation(ref msg)) if msg.contains("sudah ada")),
                "{clash:?}: {dup:?}"
            );
        }

        // The import would find the same category for either spelling.
        let found = find_by_name(&conn, " sEMBAKO ")
            .await
            .expect("query")
            .expect("found");
        assert_eq!(found.id, category_id);
        assert_eq!(name_key(" sEMBAKO "), name_key("Sembako"));

        // A category may still change only the case of its own name.
        let recased = update(
            &conn,
            &admin(),
            UpdateCategoryInput {
                id: category_id,
                name: "SEMBAKO".to_string(),
                description: None,
            },
        )
        .await
        .expect("a category may re-case its own name");
        assert_eq!(recased.name, "SEMBAKO");
    }

    #[tokio::test]
    async fn deleting_a_category_that_is_not_there_is_a_not_found() {
        let conn = setup_test_db().await;
        match delete(&conn, &admin(), 999).await.unwrap_err() {
            AppError::NotFound(_) => {}
            other => panic!("Expected NotFound error, got: {:?}", other),
        }
    }
}

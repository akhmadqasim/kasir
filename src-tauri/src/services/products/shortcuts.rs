//! Quick-access shortcuts on the cashier screen: pinned and most-picked products.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, FromQueryResult, Statement};

use crate::domain::products::ShortcutProduct;
use crate::entity::products;
use crate::utils::time::now_ts;
use crate::utils::AppError;

pub async fn popular(
    db: &DatabaseConnection,
    limit: Option<i64>,
) -> Result<Vec<ShortcutProduct>, AppError> {
    let limit = limit.unwrap_or(20).clamp(1, 200);

    // Shortcuts with product data: pinned first, then by select_count
    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            r#"SELECT p.id, p.barcode, p.sku, p.name, p.category_id, p.buy_price,
                      p.sell_price, p.margin, p.stock, p.unit, p.min_stock, p.is_active,
                      p.created_at, p.updated_at,
                      s.is_pinned AS shortcut_is_pinned,
                      s.select_count AS shortcut_select_count
               FROM products p
               INNER JOIN product_shortcuts s ON p.id = s.product_id
               WHERE p.is_active = 1
                 AND (s.is_pinned = 1 OR s.select_count > 0)
               ORDER BY s.is_pinned DESC, s.select_count DESC
               LIMIT $1"#,
            vec![limit.into()],
        ))
        .await?;

    rows.iter()
        .map(|row| {
            Ok(ShortcutProduct {
                product: products::Model::from_query_result(row, "")?,
                is_pinned: row.try_get("", "shortcut_is_pinned")?,
                select_count: row.try_get("", "shortcut_select_count")?,
            })
        })
        .collect()
}

pub async fn track_selection(db: &DatabaseConnection, product_id: i64) -> Result<(), AppError> {
    let now = now_ts();

    // One upsert rather than read-then-write: two quick picks of the same
    // product would otherwise both read the old count (losing an increment),
    // or both find no row and the second INSERT hit UNIQUE(product_id).
    db.execute(Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "INSERT INTO product_shortcuts (product_id, select_count, is_pinned, last_selected_at, created_at) \
         VALUES (?, 1, 0, ?, ?) \
         ON CONFLICT(product_id) DO UPDATE SET \
           select_count = select_count + 1, \
           last_selected_at = excluded.last_selected_at",
        vec![product_id.into(), now.clone().into(), now.into()],
    ))
    .await?;

    Ok(())
}

/// Flip the pin on a product's quick-access shortcut, creating it if needed.
/// Returns the new pinned state.
///
/// One upsert, for the same reason as [`track_selection`]: the old
/// read-then-write let a double click on a product with no shortcut yet send
/// two INSERTs, the second failing on UNIQUE(product_id), and two quick
/// toggles on an existing one could both read the same state and both write
/// its opposite, leaving the pin where it started.
pub async fn toggle_pin(db: &DatabaseConnection, product_id: i64) -> Result<bool, AppError> {
    let now = now_ts();

    let row = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO product_shortcuts (product_id, select_count, is_pinned, last_selected_at, created_at) \
             VALUES (?, 0, 1, ?, ?) \
             ON CONFLICT(product_id) DO UPDATE SET is_pinned = NOT is_pinned \
             RETURNING is_pinned",
            vec![product_id.into(), now.clone().into(), now.into()],
        ))
        .await?
        .ok_or_else(|| AppError::Internal("Upsert shortcut tidak mengembalikan baris".into()))?;

    Ok(row.try_get("", "is_pinned")?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::products::CreateProductInput;
    use crate::services::products::create;
    use crate::services::products::test_fixtures::{admin, make_valid_input};
    use crate::test_support::setup_test_db;

    /// Selecting a product is one upsert: the first pick creates the shortcut,
    /// later picks bump the count, and `popular` reads the count and pin
    /// straight off the join.
    #[tokio::test]
    async fn selections_are_counted_and_popular_reports_them() {
        let conn = setup_test_db().await;
        let beras = create(&conn, &admin(), make_valid_input())
            .await
            .expect("beras");
        let gula = create(
            &conn,
            &admin(),
            CreateProductInput {
                barcode: None,
                sku: None,
                name: "Gula 1kg".to_string(),
                ..make_valid_input()
            },
        )
        .await
        .expect("gula");

        for _ in 0..3 {
            track_selection(&conn, beras.id).await.expect("track");
        }
        assert!(toggle_pin(&conn, gula.id).await.expect("pin"));

        let shortcuts = popular(&conn, None).await.expect("popular");
        let summary: Vec<(i64, bool, i64)> = shortcuts
            .iter()
            .map(|s| (s.product.id, s.is_pinned, s.select_count))
            .collect();
        assert_eq!(summary, vec![(gula.id, true, 0), (beras.id, false, 3)]);
    }

    /// The pin flips on every call, whether the shortcut row already exists
    /// (from a selection) or is created by the first toggle, and the flip
    /// leaves the selection count alone.
    #[tokio::test]
    async fn toggling_a_pin_flips_it_each_time() {
        let conn = setup_test_db().await;
        let beras = create(&conn, &admin(), make_valid_input())
            .await
            .expect("beras");

        assert!(toggle_pin(&conn, beras.id).await.expect("pin"));
        assert!(!toggle_pin(&conn, beras.id).await.expect("unpin"));

        track_selection(&conn, beras.id).await.expect("track");
        assert!(toggle_pin(&conn, beras.id).await.expect("pin again"));

        let shortcuts = popular(&conn, None).await.expect("popular");
        assert_eq!(shortcuts.len(), 1);
        assert!(shortcuts[0].is_pinned);
        assert_eq!(shortcuts[0].select_count, 1);
    }
}

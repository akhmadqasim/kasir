//! What is on the shelf right now, and what it is worth at cost.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

use super::REPORT_ROW_LIMIT;
use crate::domain::reports::{CurrentStockReport, CurrentStockRow};
use crate::services::products::LOW_STOCK_SQL;
use crate::utils::AppError;

pub async fn current_stock(
    db: &DatabaseConnection,
    search: String,
    filter: String,
) -> Result<CurrentStockReport, AppError> {
    query_current_stock(db, &search, &filter, REPORT_ROW_LIMIT).await
}

async fn query_current_stock(
    db: &DatabaseConnection,
    search: &str,
    filter: &str,
    limit: i64,
) -> Result<CurrentStockReport, AppError> {
    // One shared definition of "low stock" — see `products::LOW_STOCK_SQL`.
    let low_stock_clause = if filter == "low" {
        format!("AND {LOW_STOCK_SQL}")
    } else {
        // "all", empty, and anything unrecognised: no extra filter.
        String::new()
    };

    let sql = format!(
        "SELECT
            p.id,
            p.barcode,
            p.name,
            c.name as category_name,
            p.stock,
            p.min_stock,
            p.unit,
            p.buy_price,
            p.sell_price,
            p.buy_price * p.stock as stock_value,
            COUNT(*) OVER () as total_count
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.is_active = 1
        AND ($1 = '' OR p.name LIKE '%' || $1 || '%' OR p.barcode LIKE '%' || $1 || '%')
        {low_stock_clause}
        ORDER BY p.name
        LIMIT $2"
    );

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            &sql,
            vec![search.into(), limit.into()],
        ))
        .await?;

    let total_count = rows
        .first()
        .and_then(|row| row.try_get_by_index::<i64>(10).ok())
        .unwrap_or(0);

    let items = rows
        .iter()
        .map(|row| CurrentStockRow {
            product_id: row.try_get_by_index(0).unwrap_or(0),
            barcode: row.try_get_by_index(1).ok(),
            product_name: row.try_get_by_index(2).unwrap_or_default(),
            category_name: row.try_get_by_index(3).ok(),
            stock: row.try_get_by_index(4).unwrap_or(0),
            min_stock: row.try_get_by_index(5).unwrap_or(0),
            unit: row.try_get_by_index(6).unwrap_or_default(),
            buy_price: row.try_get_by_index(7).unwrap_or(0.0),
            sell_price: row.try_get_by_index(8).unwrap_or(0.0),
            stock_value: row.try_get_by_index(9).unwrap_or(0.0),
        })
        .collect();

    Ok(CurrentStockReport { items, total_count })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{insert_product, setup_test_db};

    #[tokio::test]
    async fn current_stock_reports_total_count_when_truncated() {
        let conn = setup_test_db().await;
        insert_product(&conn, "Beras", 30_000.0, 50_000.0, 10).await;
        insert_product(&conn, "Gula", 20_000.0, 30_000.0, 10).await;
        insert_product(&conn, "Minyak", 10_000.0, 20_000.0, 10).await;

        let report = query_current_stock(&conn, "", "all", 2)
            .await
            .expect("query");

        assert_eq!(report.items.len(), 2);
        assert_eq!(report.total_count, 3);
    }

    #[tokio::test]
    async fn current_stock_total_count_matches_items_when_not_truncated() {
        let conn = setup_test_db().await;
        insert_product(&conn, "Beras", 30_000.0, 50_000.0, 10).await;
        insert_product(&conn, "Gula", 20_000.0, 30_000.0, 10).await;

        let report = query_current_stock(&conn, "", "all", REPORT_ROW_LIMIT)
            .await
            .expect("query");

        assert_eq!(report.items.len(), 2);
        assert_eq!(report.total_count, 2);
    }
}

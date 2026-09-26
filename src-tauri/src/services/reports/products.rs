//! Sales per product: the full product report and the ranked "popular" list,
//! both over one net-of-returns aggregate that the dashboard's top products
//! card reads as well.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

use super::net_revenue::{refund_adjust_cte, SALE_FILTER};
use super::{day_end_exclusive_utc, day_start_utc};
use crate::domain::reports::{PopularProductRow, ProductSalesRow};
use crate::utils::AppError;

/// The `sold` CTE the product aggregate builds on: per-product quantity,
/// revenue and cost over the period, before returns.
///
/// Revenue is `net_subtotal` — the rupiah the line actually brought in, with
/// its own discount and its share of the transaction discount already taken off
/// (migration 018). `SUM(ti.subtotal)` was the list price, so on any discounted
/// sale the product report claimed more revenue than the transaction reports
/// did, and deducting a (net) refund from it would have compared two different
/// currencies.
///
/// `transaction_items.product_id` is NULL for PPOB lines, so they are excluded.
/// Grouping over the NULL key produced one fabricated `productId: 0` row
/// carrying an arbitrary PPOB name and every PPOB sale's qty and revenue.
fn product_sold_cte() -> String {
    format!(
        "sold AS (
    SELECT
        ti.product_id as product_id,
        MAX(ti.product_name) as product_name,
        SUM(ti.quantity) as qty,
        SUM(ti.net_subtotal) as revenue,
        SUM(ti.quantity * COALESCE(ti.buy_price, p.buy_price, 0)) as cost
    FROM transaction_items ti
    JOIN transactions t ON t.id = ti.transaction_id
    LEFT JOIN products p ON p.id = ti.product_id
    WHERE {SALE_FILTER}
    AND t.created_at >= $1 AND t.created_at < $2
    AND ti.product_id IS NOT NULL
    GROUP BY ti.product_id
)"
    )
}

/// The CTE chain ending in `net`: one row per product with `product_id`,
/// `product_name`, `barcode`, `category_name`, `qty_sold`, `total_revenue` and
/// `total_cost`, all net of the returns booked in the period. The period's UTC
/// boundaries are expected in `$1` and `$2`.
///
/// Returned units come off the product they were sold as; exchange
/// replacements are added to the product that went out instead, which is why
/// the id list is the union of both sides — a product handed over purely as a
/// replacement still sold.
///
/// The product report, the popular list and `dashboard::top_products` all read
/// this one aggregate, so they never disagree about how much of a product
/// sold.
pub(crate) fn net_product_sales_ctes() -> String {
    format!(
        "{sold},
        {refund_adjust},
        ids AS (
            SELECT product_id FROM sold
            UNION
            SELECT bucket as product_id FROM refund_adjust
        ),
        net AS (
            SELECT
                i.product_id as product_id,
                COALESCE(s.product_name, p.name, '(dihapus)') as product_name,
                p.barcode as barcode,
                c.name as category_name,
                COALESCE(s.qty, 0) - COALESCE(ra.qty, 0) as qty_sold,
                COALESCE(s.revenue, 0) - COALESCE(ra.revenue, 0) as total_revenue,
                COALESCE(s.cost, 0) - COALESCE(ra.cost, 0) as total_cost
            FROM ids i
            LEFT JOIN sold s ON s.product_id = i.product_id
            LEFT JOIN refund_adjust ra ON ra.bucket = i.product_id
            LEFT JOIN products p ON p.id = i.product_id
            LEFT JOIN categories c ON c.id = p.category_id
        )",
        sold = product_sold_cte(),
        refund_adjust = refund_adjust_cte("ri.product_id", "ei.product_id", "$1", "$2"),
    )
}

pub async fn product_sales(
    db: &DatabaseConnection,
    start_date: String,
    end_date: String,
) -> Result<Vec<ProductSalesRow>, AppError> {
    let sql = format!(
        "WITH {net}
        SELECT
            product_id,
            product_name,
            barcode,
            category_name,
            qty_sold,
            total_revenue,
            total_cost,
            total_revenue - total_cost as profit
        FROM net
        ORDER BY qty_sold DESC",
        net = net_product_sales_ctes(),
    );

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            &sql,
            vec![
                day_start_utc(&start_date)?.into(),
                day_end_exclusive_utc(&end_date)?.into(),
            ],
        ))
        .await?;

    Ok(rows
        .iter()
        .map(|row| ProductSalesRow {
            product_id: row.try_get_by_index(0).unwrap_or(0),
            product_name: row.try_get_by_index(1).unwrap_or_default(),
            barcode: row.try_get_by_index(2).ok(),
            category_name: row.try_get_by_index(3).ok(),
            qty_sold: row.try_get_by_index(4).unwrap_or(0),
            total_revenue: row.try_get_by_index(5).unwrap_or(0.0),
            total_cost: row.try_get_by_index(6).unwrap_or(0.0),
            profit: row.try_get_by_index(7).unwrap_or(0.0),
        })
        .collect())
}

/// Same aggregate as [`product_sales`], ranked and capped.
///
/// See [`product_sold_cte`] for why PPOB lines (NULL `product_id`) are skipped
/// and why revenue is `net_subtotal`. Ranking is on the NET quantity, so a
/// product that was mostly returned drops down the list instead of staying on
/// top on the strength of a sale that was handed straight back. Ties are broken
/// by product id, and the rows come back in rank order: ordering the output
/// separately from the window let two tied products come back as rank 2, 1.
pub async fn popular_products(
    db: &DatabaseConnection,
    start_date: String,
    end_date: String,
    limit: i32,
) -> Result<Vec<PopularProductRow>, AppError> {
    let limit = limit.clamp(1, 500);

    let sql = format!(
        "WITH {net}
        SELECT
            ROW_NUMBER() OVER (ORDER BY qty_sold DESC, product_id ASC) as rank,
            product_id,
            product_name,
            category_name,
            qty_sold,
            total_revenue
        FROM net
        ORDER BY rank
        LIMIT $3",
        net = net_product_sales_ctes(),
    );

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            &sql,
            vec![
                day_start_utc(&start_date)?.into(),
                day_end_exclusive_utc(&end_date)?.into(),
                limit.into(),
            ],
        ))
        .await?;

    Ok(rows
        .iter()
        .map(|row| PopularProductRow {
            rank: row.try_get_by_index(0).unwrap_or(0),
            product_id: row.try_get_by_index(1).unwrap_or(0),
            product_name: row.try_get_by_index(2).unwrap_or_default(),
            category_name: row.try_get_by_index(3).ok(),
            qty_sold: row.try_get_by_index(4).unwrap_or(0),
            total_revenue: row.try_get_by_index(5).unwrap_or(0.0),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::reports::fixtures::{return_lines, three_item_sale};
    use crate::services::reports::{daily_sales, sales_period};
    use crate::test_support::{
        date_str, insert_exchange_item, insert_product, insert_refund, insert_refund_item,
        insert_transaction, insert_transaction_item, setup_test_db, today, utc_at_local_noon,
        RefundSpec,
    };

    /// PPOB line items carry `product_id = NULL`. Grouping over them produced a
    /// single fabricated `productId: 0` row holding every PPOB sale.
    async fn seed_sale_with_ppob_items(conn: &DatabaseConnection) -> i64 {
        let created_at = utc_at_local_noon(today());
        let beras = insert_product(conn, "Beras 5kg", 30_000.0, 50_000.0, 100).await;
        let txn = insert_transaction(conn, 1, 84_000.0, "completed", &created_at).await;
        insert_transaction_item(
            conn,
            txn.id,
            Some(beras.id),
            "Beras 5kg",
            50_000.0,
            30_000.0,
            1,
        )
        .await;
        insert_transaction_item(conn, txn.id, None, "Token PLN 20rb", 22_000.0, 20_000.0, 1).await;
        insert_transaction_item(conn, txn.id, None, "Pulsa 10rb", 12_000.0, 10_000.0, 1).await;
        beras.id
    }

    #[tokio::test]
    async fn product_sales_skip_items_without_product_id() {
        let conn = setup_test_db().await;
        let beras_id = seed_sale_with_ppob_items(&conn).await;
        let day = date_str(today());

        let rows = product_sales(&conn, day.clone(), day).await.expect("query");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].product_id, beras_id);
        assert_eq!(rows[0].product_name, "Beras 5kg");
        assert_eq!(rows[0].total_revenue, 50_000.0);
    }

    #[tokio::test]
    async fn popular_products_skip_items_without_product_id() {
        let conn = setup_test_db().await;
        let beras_id = seed_sale_with_ppob_items(&conn).await;
        let day = date_str(today());

        let rows = popular_products(&conn, day.clone(), day, 10)
            .await
            .expect("query");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].product_id, beras_id);
        assert_eq!(rows[0].qty_sold, 1);
    }

    /// Three products tied on one unit each: the ranks run 1, 2, 3 down the
    /// list, in product id order.
    #[tokio::test]
    async fn popular_products_come_back_in_rank_order() {
        let conn = setup_test_db().await;
        let (_, lines) = three_item_sale(&conn, &utc_at_local_noon(today())).await;
        let day = date_str(today());

        let rows = popular_products(&conn, day.clone(), day, 10)
            .await
            .expect("query");

        let ranks: Vec<i64> = rows.iter().map(|r| r.rank).collect();
        let ids: Vec<i64> = rows.iter().map(|r| r.product_id).collect();
        let mut expected_ids: Vec<i64> = lines.iter().map(|(_, product_id)| *product_id).collect();
        expected_ids.sort_unstable();
        assert_eq!(ranks, vec![1, 2, 3]);
        assert_eq!(ids, expected_ids);
    }

    /// An exchange is a return plus a sale, so only the difference moves. The
    /// units follow the goods: off the product that came back, on to the product
    /// that went out.
    #[tokio::test]
    async fn an_exchange_moves_only_the_difference() {
        let conn = setup_test_db().await;
        let created_at = utc_at_local_noon(today());

        let sarung = insert_product(&conn, "Sarung", 40_000.0, 60_000.0, 10).await;
        let peci = insert_product(&conn, "Peci", 25_000.0, 45_000.0, 10).await;
        let txn = insert_transaction(&conn, 1, 60_000.0, "completed", &created_at).await;
        let line = insert_transaction_item(
            &conn,
            txn.id,
            Some(sarung.id),
            "Sarung",
            60_000.0,
            40_000.0,
            1,
        )
        .await;

        let refund = insert_refund(
            &conn,
            RefundSpec {
                transaction_id: txn.id,
                user_id: 1,
                refund_type: "exchange",
                total_refund_amount: 60_000.0,
                total_exchange_amount: 45_000.0,
                difference_amount: 15_000.0,
                payment_method: "cash",
                shift_id: None,
                created_at: &created_at,
            },
        )
        .await;
        insert_refund_item(&conn, refund.id, line.id, sarung.id, 1, 60_000.0).await;
        insert_exchange_item(&conn, refund.id, peci.id, "Peci", 45_000.0, 1).await;

        let day = date_str(today());
        let rows = daily_sales(&conn, day.clone(), day.clone())
            .await
            .expect("query");
        assert_eq!(
            rows[0].total_revenue, 45_000.0,
            "60.000 taken, 15.000 given back — the customer kept 45.000 of goods"
        );
        assert_eq!(
            rows[0].total_cost, 25_000.0,
            "the peci's cost, not the sarung's"
        );

        let products = product_sales(&conn, day.clone(), day).await.expect("query");
        let sarung_row = products
            .iter()
            .find(|r| r.product_id == sarung.id)
            .expect("sarung row");
        let peci_row = products
            .iter()
            .find(|r| r.product_id == peci.id)
            .expect("the replacement counts as sold even though it was never rung up");
        assert_eq!(sarung_row.qty_sold, 0);
        assert_eq!(sarung_row.total_revenue, 0.0);
        assert_eq!(peci_row.qty_sold, 1);
        assert_eq!(peci_row.total_revenue, 45_000.0);
    }

    #[tokio::test]
    async fn product_sales_subtract_returned_units() {
        let conn = setup_test_db().await;
        let created_at = utc_at_local_noon(today());
        let (txn_id, lines) = three_item_sale(&conn, &created_at).await;
        return_lines(&conn, txn_id, &created_at, "cash", &lines[..2], 100_000.0).await;

        let day = date_str(today());
        let rows = product_sales(&conn, day.clone(), day.clone())
            .await
            .expect("query");

        let total_qty: i64 = rows.iter().map(|r| r.qty_sold).sum();
        let total_revenue: f64 = rows.iter().map(|r| r.total_revenue).sum();
        assert_eq!(total_qty, 1, "three units sold, two handed back");
        assert_eq!(total_revenue, 100_000.0);

        // And the product-level revenue reconciles with the period summary.
        let summary = sales_period(&conn, day.clone(), day).await.expect("query");
        assert_eq!(total_revenue, summary.total_revenue);
    }

    #[tokio::test]
    async fn popular_products_rank_on_net_quantity() {
        let conn = setup_test_db().await;
        let created_at = utc_at_local_noon(today());
        let (txn_id, lines) = three_item_sale(&conn, &created_at).await;
        // The first product sold twice as much but every unit came straight
        // back; the third kept its single sale.
        let extra = insert_transaction(&conn, 1, 100_000.0, "completed", &created_at).await;
        let extra_line = insert_transaction_item(
            &conn,
            extra.id,
            Some(lines[0].1),
            "Beras 5kg",
            100_000.0,
            60_000.0,
            1,
        )
        .await;
        return_lines(
            &conn,
            txn_id,
            &created_at,
            "cash",
            &[lines[0], (extra_line.id, lines[0].1)],
            100_000.0,
        )
        .await;

        let day = date_str(today());
        let rows = popular_products(&conn, day.clone(), day.clone(), 10)
            .await
            .expect("query");

        let beras = rows
            .iter()
            .find(|r| r.product_id == lines[0].1)
            .expect("beras row");
        assert_eq!(beras.qty_sold, 0);
        assert_eq!(beras.total_revenue, 0.0);
        assert_ne!(rows[0].product_id, lines[0].1, "it is not the top seller");

        // The two reports over the same window must not disagree.
        let sales = product_sales(&conn, day.clone(), day).await.expect("query");
        for row in &rows {
            let other = sales
                .iter()
                .find(|s| s.product_id == row.product_id)
                .expect("present in both reports");
            assert_eq!(row.qty_sold, other.qty_sold);
            assert_eq!(row.total_revenue, other.total_revenue);
        }
    }
}

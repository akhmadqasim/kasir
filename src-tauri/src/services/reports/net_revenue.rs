//! Net revenue: the SQL fragments every sales figure is built from.
//!
//! Every sales figure in the reports and in `services::dashboard` is NET: what
//! stayed in the till after returns. Gross takings are counted on the day the
//! sale was rung up, and a return is subtracted on the day the money went back
//! over the counter. See [`refund_adjust_cte`] for why that date, and
//! [`SALE_FILTER`] for why a fully refunded sale is still counted gross.

/// Sales-side status filter, written for a `transactions` aliased as `t`.
///
/// A `pending_ppob`/`ppob_failed` sale never delivered anything and a `deleted`
/// one was voided — neither ever became money. `refunded` is deliberately NOT in
/// the list: a fully returned sale really did take the customer's money on the
/// day it was rung up, and [`refund_adjust_cte`] takes it back out on the day of
/// the return. Excluding the sale as well would subtract it twice, and would
/// also rewrite a closed day's revenue the moment a late return landed.
///
/// The channel belongs here for the same reason: a `ppob`-channel sale is a bill
/// paid on the PPOB page, not goods sold, so it is left out of every sales figure
/// (the shift's drawer totals still include it).
pub(crate) const SALE_FILTER: &str =
    "t.status NOT IN ('pending_ppob', 'ppob_failed', 'deleted') AND t.channel = 'sales'";

/// The `refund_adjust` CTE: how much of a period's takings went back out.
///
/// WHICH DAY A REFUND LANDS ON
/// The refund's own day (`refunds.created_at`), not the sale's. A sale on the
/// 1st returned on the 5th put Rp 300.000 in the till on the 1st and took
/// Rp 200.000 back out on the 5th, and that is what the owner asked to see. It
/// also means a day's revenue never changes after the fact: the 1st keeps
/// reading Rp 300.000 forever, however late the return arrives. Dating the
/// deduction to the sale instead would silently rewrite reports that have
/// already been printed and reconciled. `reports::returns` and the dashboard's
/// refund counters already group refunds by their own date, so this is also the
/// only choice that agrees with the rest of the app.
///
/// WHAT AN EXCHANGE DOES
/// Returned lines subtract; replacement goods add straight back. An exchange is
/// a return plus a sale that never got written into `transaction_items`, so the
/// two halves are unioned with opposite signs and the net effect on revenue is
/// exactly `difference_amount` — the money that actually changed hands. A
/// like-for-like swap nets to zero, and a customer who upgrades and pays the
/// difference increases revenue.
///
/// SHAPE
/// One pass over `refund_items` and one over `exchange_items`, grouped once and
/// joined once by the caller. Deliberately not a correlated subquery per sale
/// row, which would re-scan the refund tables for every transaction in the
/// period.
///
/// `refund_bucket` and `exchange_bucket` are the grouping keys for the two
/// halves — the same expression for a calendar bucket, different columns when
/// grouping by product. `start`/`end` are the placeholders holding the period's
/// UTC boundaries.
pub(crate) fn refund_adjust_cte(
    refund_bucket: &str,
    exchange_bucket: &str,
    start: &str,
    end: &str,
) -> String {
    format!(
        "refund_adjust AS (
            SELECT bucket,
                   COALESCE(SUM(revenue), 0) as revenue,
                   COALESCE(SUM(cost), 0) as cost,
                   COALESCE(SUM(qty), 0) as qty
            FROM (
                SELECT {refund_bucket} as bucket,
                       ri.subtotal as revenue,
                       ri.quantity * COALESCE(ti.buy_price, p.buy_price, 0) as cost,
                       ri.quantity as qty
                FROM refunds r
                JOIN transactions t ON t.id = r.transaction_id
                JOIN refund_items ri ON ri.refund_id = r.id
                JOIN transaction_items ti ON ti.id = ri.transaction_item_id
                LEFT JOIN products p ON p.id = ti.product_id
                WHERE r.created_at >= {start} AND r.created_at < {end}
                AND {SALE_FILTER}
                UNION ALL
                SELECT {exchange_bucket} as bucket,
                       -ei.subtotal as revenue,
                       -(ei.quantity * COALESCE(p.buy_price, 0)) as cost,
                       -ei.quantity as qty
                FROM refunds r
                JOIN transactions t ON t.id = r.transaction_id
                JOIN exchange_items ei ON ei.refund_id = r.id
                LEFT JOIN products p ON p.id = ei.product_id
                WHERE r.created_at >= {start} AND r.created_at < {end}
                AND {SALE_FILTER}
            )
            GROUP BY bucket
        )"
    )
}

/// [`refund_adjust_cte`]'s counterpart for grouping by payment method: a
/// `refund_adjust` CTE (plus two helper CTEs before it) whose `revenue` per
/// bucket is what went back out on that method over `$1..$2`.
///
/// The money comes off the method it was actually returned with:
/// `refunds.payment_method` when the refund names one. When it does not (NULL,
/// or the legacy `'mixed'`), the refund is spread over the sale's own payment
/// splits in proportion to each split's amount — a Rp 60.000 cash + Rp 40.000
/// QRIS sale refunded Rp 50.000 gives back Rp 30.000 cash and Rp 20.000 QRIS.
/// A sale without split rows falls back to its own `payment_method`. A split
/// sale's `payment_method` is `'mixed'`, which is not a method money moves on,
/// so it never becomes a bucket.
///
/// Each refund's net value is its returned lines minus its replacement lines,
/// exactly as in [`refund_adjust_cte`], so an exchange still nets to
/// `difference_amount`.
///
/// `bucket` turns a method expression into the grouping key; the refund's
/// timestamp is available to it as `rn.refunded_at`.
pub(crate) fn payment_refund_adjust_cte(bucket: impl Fn(&str) -> String) -> String {
    let own_method = bucket("rn.method");
    let split_method = bucket("tp.payment_method");
    let sale_method = bucket("t.payment_method");
    format!(
        "refund_net AS (
            SELECT refund_id, transaction_id, method, refunded_at,
                   COALESCE(SUM(revenue), 0) as revenue
            FROM (
                SELECT r.id as refund_id, r.transaction_id as transaction_id,
                       NULLIF(r.payment_method, 'mixed') as method,
                       r.created_at as refunded_at,
                       ri.subtotal as revenue
                FROM refunds r
                JOIN transactions t ON t.id = r.transaction_id
                JOIN refund_items ri ON ri.refund_id = r.id
                JOIN transaction_items ti ON ti.id = ri.transaction_item_id
                WHERE r.created_at >= $1 AND r.created_at < $2
                AND {SALE_FILTER}
                UNION ALL
                SELECT r.id, r.transaction_id,
                       NULLIF(r.payment_method, 'mixed'),
                       r.created_at,
                       -ei.subtotal
                FROM refunds r
                JOIN transactions t ON t.id = r.transaction_id
                JOIN exchange_items ei ON ei.refund_id = r.id
                WHERE r.created_at >= $1 AND r.created_at < $2
                AND {SALE_FILTER}
            )
            GROUP BY refund_id
        ),
        refund_split_total AS (
            SELECT tp.transaction_id, SUM(tp.amount) as amount
            FROM transaction_payments tp
            WHERE tp.transaction_id IN (SELECT transaction_id FROM refund_net WHERE method IS NULL)
            GROUP BY tp.transaction_id
        ),
        refund_adjust AS (
            SELECT bucket, COALESCE(SUM(revenue), 0) as revenue
            FROM (
                SELECT {own_method} as bucket, rn.revenue as revenue
                FROM refund_net rn
                WHERE rn.method IS NOT NULL
                UNION ALL
                SELECT {split_method}, rn.revenue * tp.amount / st.amount
                FROM refund_net rn
                JOIN refund_split_total st ON st.transaction_id = rn.transaction_id
                JOIN transaction_payments tp ON tp.transaction_id = rn.transaction_id
                WHERE rn.method IS NULL AND st.amount <> 0
                UNION ALL
                SELECT {sale_method}, rn.revenue
                FROM refund_net rn
                JOIN transactions t ON t.id = rn.transaction_id
                LEFT JOIN refund_split_total st ON st.transaction_id = rn.transaction_id
                WHERE rn.method IS NULL AND (st.amount IS NULL OR st.amount = 0)
            )
            GROUP BY bucket
        )"
    )
}

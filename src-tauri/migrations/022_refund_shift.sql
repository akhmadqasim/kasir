-- Migration 022: attribute a refund to the shift that paid it out (B23)
--
-- `build_shift_summary` computed
--   expected_cash = opening_cash + cash_sales + cash_in - cash_out
-- and never looked at `refunds` at all, because there was nothing to look at:
-- the table had no shift. A cashier who handed Rp 50.000 back in cash closed the
-- day Rp 50.000 "short" against a drawer that was physically correct.
--
-- The refund belongs to the shift that OPENED THE DRAWER, not to the shift that
-- made the sale. A sale on Monday returned on Friday takes Friday's cash out of
-- Friday's till; Monday's drawer was reconciled and handed over long ago.
--
-- New refunds get this column from the actor's open shift at creation time, the
-- same rule `transactions.shift_id` follows.
ALTER TABLE refunds ADD COLUMN shift_id INTEGER REFERENCES shifts(id);

CREATE INDEX IF NOT EXISTS idx_refunds_shift ON refunds(shift_id);

-- The refund-side report aggregates (`services/reports.rs`,
-- `services/dashboard.rs`) walk `refund_items`/`exchange_items` by `refund_id`
-- once per period. Without these both were full scans of the child table.
CREATE INDEX IF NOT EXISTS idx_refund_items_refund ON refund_items(refund_id);
CREATE INDEX IF NOT EXISTS idx_exchange_items_refund ON exchange_items(refund_id);

-- BACKFILL
--
-- `shifts.opened_at`/`closed_at` and `refunds.created_at` are all UTC
-- `"YYYY-MM-DD HH:MM:SS"` strings, so they compare lexicographically. A refund is
-- placed in the shift of the SAME user whose window contains it; where several
-- could match, the most recently opened one wins.
--
-- WHAT THIS RECOVERS
--   * Refunds taken by a cashier while that cashier had a shift open — the
--     normal case, and the one the shortfall complaint comes from.
--
-- WHAT IT CANNOT RECOVER
--   * Refunds taken with no shift open. Shifts are optional (`transactions.
--     shift_id` is nullable too), so these stay NULL and, exactly as today,
--     count against no drawer.
--   * Refunds taken by user A against a drawer user B opened. The match is on
--     `user_id`, because that is the only link the schema has.
--   * A shift that was opened and never closed swallows every later refund by
--     that user, including ones made days after the drawer changed hands. There
--     is no closing timestamp to bound it with.
--   * Refunds with a NULL `created_at` cannot be placed at all.
--   * HOW the money actually went back. `refunds.payment_method` is copied from
--     the original sale, so a cash payout against a QRIS sale is invisible and a
--     QRIS reversal of a cash sale is counted as cash leaving the drawer.
--     Nothing in the schema records the refund's own tender, so the backfill —
--     and the live calculation — can only assume the money came back the way it
--     went in.
UPDATE refunds
SET shift_id = (
    SELECT s.id
    FROM shifts s
    WHERE s.user_id = refunds.user_id
      AND s.opened_at <= refunds.created_at
      AND (s.closed_at IS NULL OR refunds.created_at <= s.closed_at)
    ORDER BY s.opened_at DESC
    LIMIT 1
)
WHERE refunds.created_at IS NOT NULL;

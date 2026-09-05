-- Migration 019: normalise stock_writeoffs.created_at to UTC
--
-- `commands/stock.rs` was the only place in the backend that wrote a domain
-- `created_at` with `chrono::Local::now()`. Every reader of this column
-- (`list_stock_writeoffs`, `report_losses`) converts a local calendar date into
-- a UTC boundary before filtering, and the refund path
-- (`commands/refunds.rs::create_refund_internal`) has always written
-- `chrono::Utc::now()` into the very same column. The column therefore holds two
-- timezones: in WIB (UTC+7) a manual write-off at 18:00 on the 5th was stored as
-- "2026-09-05 18:00:00" and read back as 01:00 local on the 6th, so it dropped
-- out of the 5th's Kerugian report and reappeared on the 6th's.
--
-- ROW IDENTIFICATION ASSUMPTION
-- `refund_id IS NULL` is taken as an exact partition of "written by the manual
-- path with Local::now()". Justification:
--   * There are exactly two producers of this table. `create_stock_writeoff`
--     always sets `refund_id = NULL`; `create_refund_internal` always sets it to
--     the refund's id, and has used UTC since it was written.
--   * No code path ever moves a row between the two (`refund_id` is only ever
--     written at insert time).
--   * Migrations run at startup inside `db::setup_database`, before any Tauri
--     command can execute, so every manual row present when this runs was
--     written by the pre-fix binary. Rows inserted afterwards are already UTC.
--
-- `datetime(X,'utc')` reads X as local wall-clock time and returns the
-- corresponding UTC instant -- exactly the inverse of the bug. On a machine
-- already running in UTC it is a no-op. Values SQLite cannot parse evaluate to
-- NULL and are excluded by the third predicate so they are left as-is rather
-- than being nulled out.
--
-- LIMITATION: the shift uses the timezone of the machine performing the
-- migration. Moving a database to a terminal in a different timezone before its
-- first launch on the new binary would shift by that terminal's offset instead.
-- For this single-terminal, single-timezone (WIB, no DST) deployment that case
-- does not arise.
UPDATE stock_writeoffs
SET created_at = strftime('%Y-%m-%d %H:%M:%S', datetime(created_at, 'utc'))
WHERE refund_id IS NULL
  AND created_at IS NOT NULL
  AND datetime(created_at, 'utc') IS NOT NULL;

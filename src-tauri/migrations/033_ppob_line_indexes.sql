-- Migration 033: indexes for the PPOB reads that run often.
--
-- The history status filters ask `transactions.id IN (SELECT transaction_id
-- FROM transaction_items WHERE ppob_status IN (...))`, and the reconciler and
-- the "Perlu dicek" count look lines up by `ppob_status`. A partial index over
-- the PPOB lines only (goods lines have a NULL status) answers all of them,
-- and carrying `transaction_id` makes it covering for the filter. It replaces
-- the full `ppob_status` index from migration 006: nothing looks lines up by
-- a NULL status.
CREATE INDEX IF NOT EXISTS idx_transaction_items_ppob_open
    ON transaction_items(ppob_status, transaction_id)
    WHERE ppob_status IS NOT NULL;

DROP INDEX IF EXISTS idx_transaction_items_ppob_status;

-- The reconciler loads the PPOB lines created or retried since a moment
-- (`service_type IS NOT NULL AND (created_at >= ? OR ppob_last_attempt_at >= ?)`).
-- One partial index per side lets SQLite answer the OR with two range scans.
CREATE INDEX IF NOT EXISTS idx_ti_ppob_created
    ON transaction_items(created_at)
    WHERE service_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ti_ppob_last_attempt
    ON transaction_items(ppob_last_attempt_at)
    WHERE ppob_last_attempt_at IS NOT NULL;

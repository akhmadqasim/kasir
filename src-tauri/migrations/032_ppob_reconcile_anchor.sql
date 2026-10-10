-- Migration 032: what the Mitra history reconciler needs to settle a PPOB line
-- safely.
--
-- `ppob_last_attempt_at` (UTC, `YYYY-MM-DD HH:MM:SS`) is when the latest
-- payment request for the line went out. NULL means the only attempt was the
-- one fulfilment started at checkout, i.e. at `created_at`; a retry sets it.
-- The reconciler anchors its window on `COALESCE(ppob_last_attempt_at,
-- created_at)` and ignores history rows from before it, so a row from an
-- earlier attempt cannot settle a retry that is still pending.
ALTER TABLE transaction_items ADD COLUMN ppob_last_attempt_at TEXT;

-- `ppob_history_trx_id` is the Mitra history `trx_id` a line was settled from.
-- One history row pays for one line: the unique index makes a second line
-- claiming the same row impossible, not merely unlikely.
ALTER TABLE transaction_items ADD COLUMN ppob_history_trx_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transaction_items_ppob_history_trx
    ON transaction_items(ppob_history_trx_id)
    WHERE ppob_history_trx_id IS NOT NULL;

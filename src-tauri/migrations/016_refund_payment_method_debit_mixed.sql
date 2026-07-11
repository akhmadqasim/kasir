-- Migration 016: allow 'debit' and 'mixed' refund payment methods
-- The refunds.payment_method CHECK from 001 only permits cash/qris/ewallet/transfer,
-- but transactions were widened to include 'debit' and 'mixed' (013/014). Recreate the
-- refunds table so a refund recorded against such a transaction can store the same method.
-- FK enforcement is disabled by the migration runner for the duration of this migration;
-- ids are preserved so refund_items, exchange_items and stock_writeoffs FKs stay valid.
CREATE TABLE refunds_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_number TEXT NOT NULL UNIQUE,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('refund', 'exchange')),
  total_refund_amount REAL NOT NULL,
  total_exchange_amount REAL DEFAULT 0,
  difference_amount REAL DEFAULT 0,
  payment_method TEXT CHECK(payment_method IN ('cash', 'qris', 'debit', 'ewallet', 'transfer', 'mixed')),
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO refunds_new (
  id,
  refund_number,
  transaction_id,
  user_id,
  type,
  total_refund_amount,
  total_exchange_amount,
  difference_amount,
  payment_method,
  reason,
  created_at
)
SELECT
  id,
  refund_number,
  transaction_id,
  user_id,
  type,
  total_refund_amount,
  total_exchange_amount,
  difference_amount,
  payment_method,
  reason,
  created_at
FROM refunds;

DROP TABLE refunds;
ALTER TABLE refunds_new RENAME TO refunds;

CREATE INDEX IF NOT EXISTS idx_refunds_transaction ON refunds(transaction_id);
CREATE INDEX IF NOT EXISTS idx_refunds_date ON refunds(created_at);

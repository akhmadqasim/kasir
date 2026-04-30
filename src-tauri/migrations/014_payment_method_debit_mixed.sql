-- Migration 014: allow debit and mixed payment methods in transactions constraint
CREATE TABLE transactions_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_number TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    total_amount REAL NOT NULL,
    subtotal_amount REAL NOT NULL DEFAULT 0,
    discount_amount REAL NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL CHECK(payment_method IN ('cash', 'qris', 'debit', 'ewallet', 'transfer', 'mixed')),
    payment_amount REAL NOT NULL,
    change_amount REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'pending_ppob', 'ppob_failed', 'refunded', 'partial_refund', 'deleted')),
    notes TEXT,
    shift_id INTEGER REFERENCES shifts(id),
    deleted_at TEXT DEFAULT NULL,
    deleted_by INTEGER DEFAULT NULL REFERENCES users(id),
    deleted_reason TEXT DEFAULT NULL,
    updated_at TEXT DEFAULT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO transactions_new (
    id,
    receipt_number,
    user_id,
    total_amount,
    subtotal_amount,
    discount_amount,
    payment_method,
    payment_amount,
    change_amount,
    status,
    notes,
    shift_id,
    deleted_at,
    deleted_by,
    deleted_reason,
    updated_at,
    created_at
)
SELECT
    id,
    receipt_number,
    user_id,
    total_amount,
    subtotal_amount,
    discount_amount,
    payment_method,
    payment_amount,
    change_amount,
    status,
    notes,
    shift_id,
    deleted_at,
    deleted_by,
    deleted_reason,
    updated_at,
    created_at
FROM transactions;

DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_receipt ON transactions(receipt_number);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_shift ON transactions(shift_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date_status ON transactions(created_at, status);

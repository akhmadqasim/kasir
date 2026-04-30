CREATE TABLE IF NOT EXISTS transaction_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL,
    payment_method TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transaction_payments_transaction_id
ON transaction_payments(transaction_id);

CREATE INDEX IF NOT EXISTS idx_transaction_payments_method
ON transaction_payments(payment_method);

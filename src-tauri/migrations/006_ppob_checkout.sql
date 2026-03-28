CREATE TABLE transactions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_number TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  total_amount REAL NOT NULL,
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash', 'qris', 'ewallet', 'transfer')),
  payment_amount REAL NOT NULL,
  change_amount REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'pending_ppob', 'ppob_failed', 'refunded', 'partial_refund')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO transactions_new (
  id,
  receipt_number,
  user_id,
  total_amount,
  payment_method,
  payment_amount,
  change_amount,
  status,
  notes,
  created_at
)
SELECT
  id,
  receipt_number,
  user_id,
  total_amount,
  payment_method,
  payment_amount,
  change_amount,
  status,
  notes,
  created_at
FROM transactions;

DROP TABLE transactions;

ALTER TABLE transactions_new RENAME TO transactions;

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_receipt ON transactions(receipt_number);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);

CREATE TABLE transaction_items_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  product_id INTEGER REFERENCES products(id),
  product_name TEXT NOT NULL,
  product_price REAL NOT NULL,
  buy_price REAL DEFAULT 0,
  quantity INTEGER NOT NULL,
  subtotal REAL NOT NULL,
  service_type TEXT,
  service_ref TEXT,
  ppob_product_id INTEGER,
  ppob_product_code TEXT,
  ppob_inquiry_id TEXT,
  ppob_payment_code TEXT,
  ppob_status TEXT,
  ppob_message TEXT,
  ppob_serial_number TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO transaction_items_new (
  id,
  transaction_id,
  product_id,
  product_name,
  product_price,
  buy_price,
  quantity,
  subtotal,
  service_type,
  service_ref,
  created_at
)
SELECT
  id,
  transaction_id,
  product_id,
  product_name,
  product_price,
  buy_price,
  quantity,
  subtotal,
  service_type,
  service_ref,
  created_at
FROM transaction_items;

DROP TABLE transaction_items;

ALTER TABLE transaction_items_new RENAME TO transaction_items;

CREATE INDEX IF NOT EXISTS idx_transaction_items_txn ON transaction_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_items_service ON transaction_items(service_type);
CREATE INDEX IF NOT EXISTS idx_transaction_items_ppob_status ON transaction_items(ppob_status);

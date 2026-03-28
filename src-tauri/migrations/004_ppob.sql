-- Recreate transaction_items with nullable product_id and new PPOB columns
DROP TABLE IF EXISTS transaction_items_new;
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO transaction_items_new (id, transaction_id, product_id, product_name, product_price, buy_price, quantity, subtotal, created_at)
SELECT id, transaction_id, product_id, product_name, product_price, 0, quantity, subtotal, created_at
FROM transaction_items;

DROP TABLE transaction_items;

ALTER TABLE transaction_items_new RENAME TO transaction_items;

-- Recreate indexes
CREATE INDEX idx_transaction_items_txn ON transaction_items(transaction_id);
CREATE INDEX idx_transaction_items_service ON transaction_items(service_type);

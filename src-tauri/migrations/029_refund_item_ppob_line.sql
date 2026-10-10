-- Migration 029: let a refund line point at a PPOB line.
--
-- A PPOB line whose top-up failed was never delivered, so the money for it
-- has to go back to the customer. Such a line has no product (its
-- `transaction_items.product_id` is NULL since 004), and `refund_items` was
-- created with `product_id NOT NULL`: a failed pulsa in a mixed cart stayed in
-- revenue and in the shift's expected cash forever.
--
-- Recreate `refund_items` with a nullable `product_id`. A NULL there means a
-- money-only line: no stock went back and nothing was written off.
-- FK enforcement is disabled by the migration runner for the duration of this
-- migration; ids are preserved, and no other table references refund_items.
CREATE TABLE refund_items_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_id INTEGER NOT NULL REFERENCES refunds(id),
  transaction_item_id INTEGER NOT NULL REFERENCES transaction_items(id),
  product_id INTEGER REFERENCES products(id),
  quantity INTEGER NOT NULL,
  subtotal REAL NOT NULL,
  condition TEXT CHECK(condition IN ('good', 'damaged', 'expired')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO refund_items_new (
  id,
  refund_id,
  transaction_item_id,
  product_id,
  quantity,
  subtotal,
  condition,
  created_at
)
SELECT
  id,
  refund_id,
  transaction_item_id,
  product_id,
  quantity,
  subtotal,
  condition,
  created_at
FROM refund_items;

DROP TABLE refund_items;
ALTER TABLE refund_items_new RENAME TO refund_items;

CREATE INDEX IF NOT EXISTS idx_refund_items_refund ON refund_items(refund_id);
CREATE INDEX IF NOT EXISTS idx_refund_items_txn_item ON refund_items(transaction_item_id);

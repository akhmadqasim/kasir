-- Migration 007: Add discount support to transactions
-- Tracks per-item and transaction-level discounts separately

-- Transaction-level discount fields
ALTER TABLE transactions ADD COLUMN subtotal_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0;

-- Per-item discount
ALTER TABLE transaction_items ADD COLUMN item_discount REAL NOT NULL DEFAULT 0;

-- Migration 017: drop redundant indexes
-- Each of these duplicates an index that already exists:
--   * idx_products_barcode          -> products.barcode is UNIQUE (covered by its auto-index)
--   * idx_transactions_receipt      -> transactions.receipt_number is UNIQUE (covered by its auto-index)
--   * idx_product_shortcuts_product -> product_shortcuts.product_id is UNIQUE (covered by its auto-index)
--   * idx_transactions_date         -> leftmost prefix of composite idx_transactions_date_status(created_at, status)
DROP INDEX IF EXISTS idx_products_barcode;
DROP INDEX IF EXISTS idx_transactions_receipt;
DROP INDEX IF EXISTS idx_product_shortcuts_product;
DROP INDEX IF EXISTS idx_transactions_date;

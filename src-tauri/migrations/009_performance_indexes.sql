-- Performance indexes for frequently queried columns
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_shift ON transactions(shift_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date_status ON transactions(created_at, status);
CREATE INDEX IF NOT EXISTS idx_transaction_items_product ON transaction_items(product_id);

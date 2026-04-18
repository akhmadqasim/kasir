-- Migration 011: Add soft delete and audit fields to transactions
ALTER TABLE transactions ADD COLUMN deleted_at TEXT DEFAULT NULL;
ALTER TABLE transactions ADD COLUMN deleted_by INTEGER DEFAULT NULL REFERENCES users(id);
ALTER TABLE transactions ADD COLUMN deleted_reason TEXT DEFAULT NULL;
ALTER TABLE transactions ADD COLUMN updated_at TEXT DEFAULT NULL;

-- Migration 015: add optional bank_name metadata to transaction payments
ALTER TABLE transaction_payments ADD COLUMN bank_name TEXT DEFAULT NULL;

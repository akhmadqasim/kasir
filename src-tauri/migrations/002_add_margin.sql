-- Add margin column to products table
ALTER TABLE products ADD COLUMN margin REAL NOT NULL DEFAULT 0;

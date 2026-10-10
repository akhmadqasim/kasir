-- Migration 027: snapshot the buy price of an exchange's replacement goods.
--
-- A sold line keeps its own `transaction_items.buy_price`, but a replacement
-- handed over on an exchange had none, so the reports costed it at the
-- product's CURRENT buy price: editing a product's cost rewrote the profit of
-- days that were already closed. The new column is written when the exchange
-- is recorded and read by the reports.
--
-- Existing rows are backfilled from today's `products.buy_price` — the best
-- figure there is for them. NULL stays possible (a product row that no longer
-- exists), and the reports fall back to the product row in that case.

ALTER TABLE exchange_items ADD COLUMN buy_price REAL;

UPDATE exchange_items
SET buy_price = (SELECT p.buy_price FROM products p WHERE p.id = exchange_items.product_id)
WHERE buy_price IS NULL;

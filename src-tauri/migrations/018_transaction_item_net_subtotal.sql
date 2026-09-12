-- Migration 018: persist the net amount actually paid for each sold line
--
-- Money for a sale line was recomputed independently by refunds, the reports
-- and the two receipt renderers, and those copies disagreed about discounts:
-- refunds charged the shop `product_price * quantity` and ignored both
-- `transaction_items.item_discount` and the transaction-level discount folded
-- into `transactions.discount_amount`.
--
-- `net_subtotal` is now the single stored answer -- the rupiah the customer
-- actually handed over for that line:
--
--   line_net     = subtotal - item_discount
--   net_subtotal = line_net - transaction_discount * line_net / SUM(line_net)
--
-- so SUM(net_subtotal) over a transaction equals transactions.total_amount.
--
-- BACKFILL LIMITATION
-- The transaction-level discount was never stored per line, and
-- `transactions.discount_amount` is the SUM of the item discounts plus that
-- transaction-level discount, with no record of the split. Rows written before
-- migration 007 do not have the discount columns filled at all, and any later
-- edit to a line would move the two halves independently. Splitting
-- `discount_amount` back apart per line is therefore guesswork, so the backfill
-- only restores the part that IS recorded per line:
--
--   net_subtotal = subtotal - COALESCE(item_discount, 0)
--
-- That is exact for every historical sale without a transaction-level discount,
-- which is the overwhelming majority. Where one does exist, the line is
-- overstated by that line's share of it -- bounded by `discount_amount`, and far
-- closer than the pre-fix behaviour of ignoring every discount. New sales are
-- written with the fully prorated value from checkout onward.
ALTER TABLE transaction_items ADD COLUMN net_subtotal REAL NOT NULL DEFAULT 0;

UPDATE transaction_items
SET net_subtotal = subtotal - COALESCE(item_discount, 0);

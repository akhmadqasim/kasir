-- Migration 025: which screen rang the sale up.
--
-- `sales` is the cashier's cart (goods, possibly with PPOB lines mixed in);
-- `ppob` is a purchase completed on the PPOB page itself. Both are real sales
-- — same receipt, same shift drawer, same fulfilment — but the sales history,
-- the reports and the dashboard only count `sales`, so the shop's goods
-- figures are not inflated by bill payments made from the other screen.
ALTER TABLE transactions ADD COLUMN channel TEXT NOT NULL DEFAULT 'sales';

-- Migration 028: tie a checkout's idempotency key to the sale it produced.
--
-- A key is inserted `in_progress` before the sale is written and set to
-- `completed` after it commits. A process that dies in between (a power cut
-- at the shop) leaves the key `in_progress`, and the cart and its key survive
-- the restart in the browser's localStorage: every retry was answered 409 for
-- the key's whole 24-hour life.
--
-- To recover such a key the server has to know whether the sale behind it
-- committed. The checkout now writes the sale's id here inside the sale's own
-- DB transaction, so the two can never disagree: a stranded key with a
-- `transaction_id` is completed with that sale (the retry gets a replay), and
-- one without is released (the retry rings the cart up).
--
-- No foreign key: a key outlives nothing but its 24 hours, and the sale row is
-- never deleted (a void is a soft delete).

ALTER TABLE idempotency_keys ADD COLUMN transaction_id INTEGER;

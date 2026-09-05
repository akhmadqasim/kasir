-- Migration 021: idempotency keys for the requests that move money
--
-- Over IPC a checkout could not be accidentally repeated: the call either
-- returned or the process was gone. HTTP has a third outcome. A tablet on shop
-- wifi sends `POST /api/transactions`, the sale commits, the response is lost on
-- the way back, and the retry — the browser's, or the cashier's finger on a
-- button that never stopped spinning — arrives as a second, indistinguishable
-- request. Stock is deducted twice, the customer is charged twice, and the only
-- evidence is two receipt numbers a minute apart.
--
-- The fix is the standard one: the client stamps each attempt with an
-- `Idempotency-Key`, and the server remembers what that key already produced.
--
-- WHAT `id` IS
-- SHA-256 of `scope | user_id | key`, hex encoded. Three things follow from
-- that shape. The key is scoped, so a cashier reusing "1" for a checkout and a
-- PPOB payment gets two rows rather than a false replay. It is per user, so one
-- till's key cannot collide with — or read back — another's. And it is hashed,
-- so a client-chosen string of any length becomes a fixed-width primary key
-- with no escaping question.
--
-- WHY `request_hash` IS STORED TOO
-- A key that is reused with a *different* body is a client bug, not a retry.
-- Replaying the first response would silently swallow the second sale. The
-- request digest lets that case be refused instead.
--
-- THE TWO STATES
-- A row is inserted `in_progress` before the work starts and updated to
-- `completed` with the response body once it succeeds; a failure deletes it, so
-- a sale that did not happen does not block the retry that makes it happen. A
-- request arriving while another holds the same key `in_progress` is the
-- duplicate-in-flight case and is refused rather than queued — the caller
-- already has one attempt outstanding.
--
-- EXPIRY
-- `expires_at` is 24 hours out. A retry that matters happens within seconds;
-- a day is generous enough to cover a till left offline over a shift change,
-- and short enough that the table stays small. The same hourly task that sweeps
-- dead sessions deletes rows past it.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('in_progress', 'completed')),
  response_body TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- The sweep deletes by expiry, exactly as it does for sessions.
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires ON idempotency_keys(expires_at);

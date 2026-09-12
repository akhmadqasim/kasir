-- Migration 020: server-side sessions
--
-- Until now the webview told the backend who it was: every privileged command
-- took a `callerId`/`userId` straight out of the request body. That is safe only
-- while the sole client is a local webview the user cannot script. The moment
-- the app answers on the LAN, anyone can POST `callerId: 1` and be an admin.
--
-- This table is the replacement. `POST /api/auth/login` verifies the PIN, mints
-- a 256-bit random token, stores the token's SHA-256 hash here, and hands the
-- raw token to the browser in an HttpOnly cookie. Identity then comes from a
-- primary-key lookup on this table and never from the request body.
--
-- WHY THE HASH IS THE PRIMARY KEY
-- The row is only ever found by the token the client presents, and the token is
-- never stored. Making the hash the key gives that lookup an index for free and
-- removes any second identifier that could be confused with the secret. Someone
-- who reads the database file gets session hashes, which are useless without the
-- pre-image, exactly as `users.pin_hash` is useless without the PIN.
--
-- Timestamps are UTC "YYYY-MM-DD HH:MM:SS" strings, the same shape every other
-- table in this schema uses. That format sorts lexicographically in the same
-- order it sorts chronologically, so `expires_at > ?` is a correct expiry filter
-- without any date parsing in SQLite.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT
);

-- Revoking every session of one account (deactivating a user, changing a PIN)
-- is a delete by `user_id`.
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- The periodic sweep deletes by expiry.
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

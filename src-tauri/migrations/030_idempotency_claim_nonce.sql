-- Migration 030: give each claim on an idempotency key its own token.
--
-- Every attempt with one key shares the row id, so a claim was told apart from
-- a retry's re-claim by `created_at` alone. That has one-second resolution:
-- two retries of a stale key could re-claim it within the same second, and a
-- conditional delete written for the first claim then matched the second.
-- A random nonce per claim makes every release, link and completion land on
-- the exact claim that read the row, and on nothing else.
--
-- Rows from before this migration get a random nonce of their own.

ALTER TABLE idempotency_keys ADD COLUMN claim_nonce TEXT NOT NULL DEFAULT '';

UPDATE idempotency_keys
SET claim_nonce = lower(hex(randomblob(16)))
WHERE claim_nonce = '';

-- Migration 024: WhatsApp receipt sends.
--
-- One row per attempt to send a struk to a customer's WhatsApp, whether it
-- succeeded or not. Its own table rather than a column on `transactions`
-- because a sale can be re-sent (a mistyped number, a customer who lost the
-- first message) and every attempt is worth keeping for "Terkirim ke
-- 0812..." in the transaction history — a single nullable column could only
-- ever remember the last one.
CREATE TABLE IF NOT EXISTS whatsapp_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  phone TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('sent', 'failed')),
  error TEXT,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sends_transaction ON whatsapp_sends(transaction_id);

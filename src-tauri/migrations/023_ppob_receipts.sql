-- Migration 023: keep the provider's payment response so a PPOB struk can be
-- reprinted later.
--
-- Fulfilment used to throw the response away the moment it had pulled the
-- status, the message and the serial number out of it. Everything a Mitra
-- Indogrosir struk shows beyond those three -- the preformatted `receipt_text`
-- block, the token, the meter/IDPEL pair, the tariff, the KWH figure -- only
-- ever existed in that response, so a struk could be printed once, from memory,
-- and never again.
--
-- Stored as the raw JSON text of the response, not as columns: the field names
-- differ per service (PLN, PDAM, BPJS, pulsa) and the provider adds new ones
-- without warning. The formatter reads it defensively and tolerates anything
-- missing.
--
-- In its own table rather than as a column on `transaction_items`, because it
-- is several kilobytes that only the printer ever reads. As a column it would
-- be fetched and thrown away by every `SELECT` over that table -- the paginated
-- sale history, fifty rows at a time, the refund screens, the admin views --
-- none of which has any use for it. One-to-one with the item, so the row is
-- keyed by the item and goes when the item goes.
CREATE TABLE IF NOT EXISTS ppob_receipts (
  transaction_item_id INTEGER PRIMARY KEY REFERENCES transaction_items(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

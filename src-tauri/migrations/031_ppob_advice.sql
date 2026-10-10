-- Migration 031: keep Mitra's ADVICE reference on a PPOB line, and stop
-- calling an ADVICE line failed.
--
-- `pln/payment` (and the other `*/payment` endpoints) can answer
-- `{"message":"ADVICE","advice_id":"…","uid":"…"}`: the payment went to the
-- biller, the result is not known yet, the balance is usually already debited
-- and the token follows later. Up to 1.3.0 any message but "OK" was a definite
-- failure, so such a line was stored `failed` ("Mitra: ADVICE", or
-- "Mitra API error: ADVICE" from older builds) — which the retry button pays
-- again and a refund pays back.
--
-- `ppob_advice` holds Mitra's references as JSON text (`{"advice_id":…,"uid":…}`)
-- and is non-NULL exactly when Mitra answered ADVICE; `{}` when the references
-- are not known (lines re-classified below: their references only ever reached
-- warning.log).
ALTER TABLE transaction_items ADD COLUMN ppob_advice TEXT;

-- An ADVICE line already stored `failed` goes back to `uncertain`, so it can be
-- reconciled against the Mitra history instead of retried or refunded. A line
-- already refunded, or on a voided sale, is left alone: its money already went
-- back to the customer, and that decision was made by a person.
--
-- Only lines from the last 90 days: `history-payment` reaches no further, so an
-- older line could never be reconciled and would only sit as "Perlu Dicek".
-- Those stay `failed`, with a note that a person has to check them in Mitra.
UPDATE transaction_items
SET ppob_status = 'uncertain',
    ppob_advice = '{}',
    ppob_message = 'Menunggu konfirmasi biller (ADVICE): pembayaran sudah terkirim, hasil akhirnya belum ada. Jangan diulang — klik Cek status. (Sebelumnya: ' || ppob_message || ')'
WHERE ppob_status = 'failed'
  AND service_type IS NOT NULL
  AND ppob_message LIKE '%ADVICE%'
  AND created_at >= datetime('now', '-90 days')
  AND NOT EXISTS (SELECT 1 FROM refund_items ri WHERE ri.transaction_item_id = transaction_items.id)
  AND EXISTS (SELECT 1 FROM transactions t
              WHERE t.id = transaction_items.transaction_id AND t.deleted_at IS NULL);

UPDATE transaction_items
SET ppob_message = ppob_message || ' — ADVICE lebih dari 90 hari, cek manual di Mitra sebelum retry atau refund.'
WHERE ppob_status = 'failed'
  AND service_type IS NOT NULL
  AND ppob_message LIKE '%ADVICE%'
  AND ppob_message NOT LIKE '%cek manual di Mitra%'
  AND (created_at IS NULL OR created_at < datetime('now', '-90 days'))
  AND NOT EXISTS (SELECT 1 FROM refund_items ri WHERE ri.transaction_item_id = transaction_items.id)
  AND EXISTS (SELECT 1 FROM transactions t
              WHERE t.id = transaction_items.transaction_id AND t.deleted_at IS NULL);

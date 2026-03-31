-- Add ppob_flag_id column for PLN payment (0=prepaid/token, 1=postpaid/tagihan)
ALTER TABLE transaction_items ADD COLUMN ppob_flag_id TEXT;

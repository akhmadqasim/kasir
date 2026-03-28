# PPOB API Specs — Mitra Indogrosir

Base URL: `https://v2.mitraindogrosir.co.id/api`
Auth: Bearer token (from POST `/login`)
All requests: POST with `device_id` in body

---

## Authentication

### POST `/login`
**Request:**
```json
{
  "phone_number": "08xxxxxxxxxx",
  "password": "xxxxx",
  "device_id": "xxxxxxxxxxxxxxxx"
}
```
**Response:**
```json
{
  "message": "OK",
  "access_token": "...",
  "refresh_token": "..."
}
```

---

## Balance & Menu

### POST `/get-menu-saldo`
**Request:** `{ "device_id": "..." }`
**Response:**
```json
{
  "message": "OK",
  "saldo": 1234567,
  "username": "...",
  "store_name": "...",
  "flag_member": "...",
  "menu": [
    { "id": 6, "group": "Tagihan & Angsuran", "image_url": null, "path_icon": "..." },
    { "id": 33, "group": "Tiket & Travel", ... }
  ]
}
```

---

## Pulsa & Data

### POST `/pulsa/get-providers`
**Response:**
```json
{
  "message": "OK",
  "providers": [
    { "uid": "encrypted_id", "provider": "TELKOMSEL", "image": "http://..." }
  ]
}
```

### POST `/pulsa/v2/get-details`
**Request:** `{ "phone_number": "08xxx", "device_id": "..." }`
**Response:**
```json
{
  "message": "OK",
  "provider": "TELKOMSEL",
  "image": "http://...",
  "pulsa": [
    {
      "id": 979,
      "plu": "223316077",
      "igr_plu": "1958140",
      "base_price": 50600,
      "vendor_price": 44964,
      "description": "TELKOMSEL 50.000,-\nMasa Aktif 45 Hari",
      "is_trouble": 0,
      "promo_id": 496,
      "nominal_cut_price": 3000,
      "last_price": 47600,
      "percentage": 6
    }
  ],
  "data": [ ... ],
  "flag_pin": "Y"
}
```

### POST `/pulsa/get-pulsa-price-list`
**Request:** `{ "provider_uid": "encrypted_id", "device_id": "..." }`
**Response:**
```json
{
  "message": "OK",
  "pulsa_options": [
    {
      "pulsa_product_id": 123,
      "plu": "...",
      "provider": "TELKOMSEL",
      "type": "PULSA",
      "description": "...",
      "product_price": 50000,
      "member_price": 48000,
      "base_price": "44964.00"
    }
  ]
}
```

### POST `/pulsa/get-data-price-list`
**Request:** `{ "provider_uid": "encrypted_id", "device_id": "..." }`
**Response:** Same structure as pulsa, key: `data_options`

---

## PLN

### POST `/pln/get-denom`
**Response:**
```json
{
  "message": "OK",
  "pln": [
    { "id": 17, "denom": "20000.00" },
    { "id": 2, "denom": "50000.00" }
  ]
}
```

### POST `/pln/inquiry`
**Request:** `{ "customer_id": "...", "payment_code": "...", "flag_id": "0", "amount": 0, "device_id": "..." }`

---

## PDAM

### POST `/pdam/get-product`
**Response:**
```json
{
  "message": "OK",
  "list_product": [
    { "id": 168, "plu": "123000858", "merchant": "AETRA Tangerang", "igr_desc": "PDAM Aetra Tangerang" }
  ]
}
```

### POST `/pdam/inquiry`
**Request:** `{ "customer_id": "...", "product_id": 168, "payment_code": "123000858", "device_id": "..." }`

---

## E-Money

### POST `/emoney/get-denom`
**Response:**
```json
{
  "message": "OK",
  "emoney": [
    { "id": 1, "denom": "20000.00" },
    { "id": 5, "denom": "50000.00" }
  ]
}
```

---

## Payment Point

### POST `/payment-point/get-sub-menu`
**Request:** `{ "pp_id": 6, "device_id": "..." }`
**Response:**
```json
{
  "message": "OK",
  "sub_menu": [
    {
      "id": 1111,
      "payment_point_group_id": 6,
      "plu": "123001200",
      "igr_plu": "1644800",
      "merchant": "ACC Finance",
      "description": "ACC Finance",
      "input_amt": 1,
      "is_trouble": 2,
      "label": "Kode Pembayaran",
      "path_icon": "http://..."
    }
  ]
}
```

---

## Transfer

### POST `/transfer-uang/channel-group`
**Response:**
```json
{
  "message": "OK",
  "channelAmount": 166,
  "channelList": [
    {
      "channel": "BANK ACEH SYARIAH",
      "details": [
        { "channel_id": "116", "product_id": 2, "type": "BIFAST", "fee": 0 }
      ]
    }
  ]
}
```

---

## Voucher

### POST `/voucher-prepaid/get/group`
**Response:**
```json
{
  "message": "OK",
  "group": [
    { "id": 1, "group": "Game Online", "icon": "..." }
  ]
}
```

---

## History (Reverse Engineered from APK)

### POST `/history-payment`
Riwayat transaksi PPOB.

**Request:**
```json
{
  "start_date": "2025-01-01",
  "end_date": "2025-03-27",
  "device_id": "..."
}
```

**Response (estimated):**
```json
{
  "message": "OK",
  "history": [
    {
      "trx_id": "...",
      "inquiry_id": "...",
      "product_name": "PLN Token 50.000",
      "description": "...",
      "serial_number": "...",
      "total": 52500,
      "amount": 50000,
      "admin_fee": 2500,
      "status": "sukses",
      "created_at": "2025-03-27 10:00:00",
      "vendor_price": 48000,
      "base_price": 50000,
      "sell_price": 52500,
      "profit": 4500,
      "margin": 2500,
      "denom": "50000.00",
      "provider": "PLN",
      "merchant": "PLN Prepaid",
      "plu": "...",
      "service_type": "pln"
    }
  ]
}
```

**Note:** Response structure is estimated based on model field names found in APK binary. Actual field names and nesting may differ. The backend should handle variations gracefully.

### POST `/history-payment/detail`
Detail satu transaksi.

**Request:**
```json
{
  "trx_id": "...",
  "device_id": "..."
}
```

**Response:** Full transaction detail (service-type specific fields).

### POST `/history-saldo`
Riwayat perubahan saldo.

### POST `/topup/history`
Riwayat top-up saldo.

---

## Confirm Payment

### POST `/confirm-payment`
**Request:** `{ "inquiry_id": "...", "pin": "...", "device_id": "..." }`
**Response:**
```json
{
  "message": "OK",
  "receipt_data": { ... },
  "serial_number": "...",
  "status": "sukses"
}
```

---

## Notes

- Semua endpoint POST, body JSON
- `device_id` wajib di setiap request
- Token dari `/login`, auto-refresh jika expired
- Harga bisa berupa number atau string (e.g., `"5283.00"` atau `50600`)
- `is_trouble` > 0 berarti produk sedang gangguan
- `promo_id` != null berarti ada diskon (`nominal_cut_price` = potongan, `last_price` = harga final)

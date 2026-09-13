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

**Catatan lapangan (akun live):** endpoint ini membalas
`{"message":"OK","errorCode":…,"errorMessage":"Inputan tidak sesuai"}` untuk
semua bentuk parameter yang dicoba (`trx_id`, `id`, string maupun angka).
Backend tidak memakainya: `GET /api/ppob/history/{trx_id}` mencari baris di
daftar `/history-payment` (90 hari terakhir, hasil di-cache 5 menit).

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

---

## Receipt / struk

Respons pembayaran yang sukses membawa bahan struk, dan namanya berbeda-beda per
layanan. Yang dipakai `printing/ppob_receipt.rs` (lewat `services/receipt.rs`,
dari tabel `ppob_receipts` — JSON respons mentah, satu baris per item, disimpan
migrasi 023):

| Field | Isi |
|---|---|
| `receipt_text` / `invoice_string` | Blok key/value yang **sudah diformat provider** (`NO METER`, `IDPEL`, `TARIF/DAYA`, `JML KWH`, …). Kalau ada, dicetak apa adanya; baris yang lebih panjang dari lebar kertas dibungkus di kolom nilai. |
| `token_number` | Token PLN prabayar, 20 digit. Dicetak double width+height, dikelompokkan per 4 digit. |
| `serial_number` / `sn` / `token` | Nomor seri layanan non-PLN. Dicetak tebal, ukuran normal. |
| `no_ref` / `ref` / `reference` / `trx_id` | Nomor referensi transaksi. |
| `customer_name` / `nama_pelanggan` | Nama pelanggan. |
| `amount`, `admin_fee`, `total` | Nominal, admin bank, dan total yang ditagih provider. |
| `footer` / `footer_text` | Baris penutup provider (call center, dsb). |

Letaknya juga berbeda: `pulsa/v2/topup` membalas `{ "history_payment": { ... } }`,
`confirm-payment` membalas `{ "receipt_data": { ... } }`, endpoint `*/payment`
membalas rata di root. Pembacanya mencoba root dan setiap wrapper yang dikenal,
bukan mencabang per service type.

**Cek terhadap Mitra app 8.25.8:** permukaan API untuk endpoint yang kita pakai
tidak berubah. Yang berubah di luar pemakaian kita: Pelni pindah ke `v2/pelni/*`
dan `pln/advice` dihapus — keduanya tidak dipakai aplikasi ini.

### Bentuk `receipt_text` (dari 20 transaksi nyata)

- **CRLF.** Semua baris dipisah `\r\n`; `\r` dibuang sebelum apa pun.
- **Sudah dibungkus provider di ~32 kolom, dan dibungkus per karakter** — jadi
  memotong di tengah kata: `NAMA : ABDUL MUKTI RI` disambung baris
  `                  AD`. Baris sambungan diawali 18 spasi (kadang 19 kalau spasi
  ke-19 itu bagian dari nilai, seperti pada token). Aturan pembacanya: baris yang
  diawali ≥10 spasi adalah sambungan baris sebelumnya; buang tepat 18 karakter
  pertama, gabung tanpa spasi, lalu bungkus ulang di lebar kertas kita.
- **PLN sudah membawa judulnya sendiri** (`STRUK PEMBELIAN LISTRIK PRABAYAR`,
  `STRUK PEMBAYARAN TAGIHAN LISTRIK`) plus dua baris kosong di depan. PDAM, BPJS,
  dan Payment Point tidak punya judul sama sekali.
- **Footer PLN pascabayar berbentuk pipe:**
  `MKM|"Informasi Hubungi Call Center 123 Atau Hub PLN Terdekat :"|Download PLN Mobile`,
  diikuti baris jejak `[I001IGR1-(11/09/2026 10:11:51)-CA]`. Segmen pendek huruf
  besar (`MKM`) adalah kode kanal, bukan untuk pelanggan.
- **Placeholder "tidak ada token" berbeda per layanan:** PLN pascabayar `""`,
  PDAM `"-"`, Payment Point `"0"`. Token PLN prabayar datang sebagai
  `4617 5400 1832 5962 7611` (kelompok spasi), bukan digit rapat.
- **`amount` sudah termasuk admin.** Contoh PLN: `base_price` 20.000 +
  `admin_fee` 3.500 = `amount` 23.500 — dan 23.500 itu yang disebut total di
  invoice PDF Mitra. Menjumlahkan `amount + admin_fee` menghitung admin dua kali.
- **Angka di dalam `receipt_text` tidak konsisten** antar layanan (`69,163` di
  PDAM/BPJS, `Rp 69.729,00` di PLN). Dicetak apa adanya; hanya baris milik kita
  yang lewat `format_rupiah`.
- **Judul Payment Point** diambil dari `description` sebelum `" - "` (mis.
  `Telkom Indihome - 161312001945` → `STRUK PEMBAYARAN Telkom Indihome`), karena
  ratusan biller berbagi satu service type dan `igr_desc`-nya `null`.

### Cetak dari riwayat (Ringkasan Transaksi)

Meniru layar "Ringkasan Transaksi" app Mitra: dari detail riwayat, kasir
mengatur "Harga Jual" lalu "Cetak Struk". Dua route, keduanya session-scoped:

- `GET /api/ppob/history/{trx_id}/receipt?sellPrice=…` — baris struk persis
  seperti yang akan dikirim ke printer (`[{text,bold,size}]`), untuk pratinjau.
- `POST /api/ppob/history/{trx_id}/print` body `{"sellPrice": …}` — cetak.

`sellPrice` jadi `Grand Total` di struk; selisihnya dari `amount` (total
provider, sudah termasuk admin) dicetak sebagai `Biaya Layanan`. `sellPrice`
negatif → 400; transaksi yang bukan `SUKSES` → 422. Harga jual default di UI
diambil dari markup PPOB per layanan (`resolvePpobSellPrice`), sama dengan yang
dipakai di kasir.

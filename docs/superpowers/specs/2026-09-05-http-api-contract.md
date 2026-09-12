# Kontrak HTTP API — pengganti 114 Tauri command

Dokumen ini adalah keluaran audit kontrak menyeluruh dan menjadi acuan fase P2 (axum + session server-side).
Sumber kebenaran daftar command: blok `tauri::generate_handler!` di `src-tauri/src/lib.rs`.

## Fakta terverifikasi

**Jumlah command: 114**, bukan 117 seperti dugaan awal (hitungan awal ikut menghitung baris `commands::` yang bukan entri handler). Seluruh 114 command terdefinisi dan terdaftar; tidak ada yang lupa didaftarkan, dan tidak ada pemanggilan frontend ke command yang tidak ada.

**Casing argumen: nol mismatch.** Tidak satu pun command memakai `rename_all = "snake_case"`, jadi semua argumen tingkat atas otomatis camelCase di sisi JavaScript, dan setiap call-site frontend sudah sesuai. Struct bersarang mengikuti atribut serde masing-masing: `stock`, `shifts`, `users`, `dashboard` camelCase; `products`, `transactions`, `refunds`, `receipt`, `settings` snake_case. Tidak ada error "invalid args" yang mengintai.

**Command yang tidak pernah dieksekusi: 18.** Delapan tanpa referensi sama sekali (`create_transaction`, `get_current_user`, `get_next_receipt_number`, `get_stock_writeoff_detail`, `list_cash_flows`, `get_data_dir`, `get_log_dir`, `ppob_get_receipt_data`), sembilan punya hook yang tidak dipakai (`get_weekly_stats`, `ppob_confirm_payment`, `ppob_pulsa_purchase`, `ppob_pp_inquiry`, `ppob_transfer_inquiry`, `ppob_get_history_detail`, `ppob_get_providers`, `ppob_get_pulsa_price_list`, `ppob_get_data_price_list`), dan satu hanya dijangkau lewat fungsi mati (`get_receipt_data` lewat `printReceipt`).

`ppob_confirm_payment` dan `ppob_pulsa_purchase` mati karena disengaja — fulfillment sekarang dipicu backend di dalam `checkout_transaction`. Keduanya kini menjadi jalur bayar kedua yang tidak mencatat transaksi apa pun, jadi sebaiknya dihapus, bukan dipindahkan ke HTTP.

## Masalah kepercayaan yang harus hilang di P2

**23 command menerima id pemanggil dari client.** Sebelas di antaranya tidak memvalidasinya sama sekali: `checkout_transaction`, `create_refund`, `delete_transaction`, `update_payment_method`, `open_shift`, `create_cash_flow`, `get_active_shift`, `get_current_user`, `change_user_pin`, `create_transaction`, `list_cash_flows`. Kasir bisa mencatat transaksi atas nama admin hanya dengan mengubah payload.

Aturan P2: parameter `caller_id`, `user_id`, dan `current_user_id` **dihapus seluruhnya dari signature**. Identitas hanya datang dari session. Menghapusnya dari signature membuat kompiler menunjukkan setiap tempat yang perlu diperbaiki — jauh lebih aman daripada menambal satu per satu.

Dua command kehilangan role check yang dimiliki saudaranya: `list_backups` dan `update_printer_settings`.

## Peta route

Prefix `/api`. Role `session` berarti perlu login; `admin` berarti perlu role admin.

| Resource | Route | Method | Role |
|---|---|---|---|
| **auth** | `/auth/login` | POST | publik |
| | `/auth/logout` | POST | session |
| | `/auth/me` | GET | session |
| | `/auth/me/pin` | PUT | session, hanya diri sendiri |
| **users** | `/users` | GET, POST | admin |
| | `/users/:id` | PATCH | admin |
| | `/users/:id/active` | PATCH | admin |
| **onboarding** | `/onboarding/status` | GET | publik |
| | `/onboarding` | POST | publik, sekali saja |
| **settings** | `/store` | GET session, PUT admin | |
| | `/settings` | GET admin, PUT admin | kredensial PPOB diredaksi di GET |
| | `/settings/ppob/markup` | GET | session — hanya tabel markup, ditambahkan P5 |
| | `/settings/database` | GET | admin |
| **products** | `/products` | GET session, POST admin | |
| | `/products/:id` | PUT, DELETE | admin |
| | `/products/bulk` | POST | admin |
| | `/products/barcode/:barcode` | GET | session |
| | `/products/popular` | GET | session |
| | `/products/:id/select`, `/products/:id/pin` | POST | session |
| | `/products/import-template` | GET | session, unduhan |
| **categories** | `/categories` | GET session, POST admin | |
| | `/categories/:id` | PUT, DELETE | admin |
| **transactions** | `/transactions` | GET, POST | session, POST wajib `Idempotency-Key` |
| | `/transactions/next-receipt-number` | GET | session |
| | `/transactions/:id` | GET, DELETE | session, DELETE adalah void dengan `reason` |
| | `/transactions/:id/payment-method` | PATCH | session |
| | `/transactions/:id/receipt` | GET | session |
| | `/transaction-items/:id/ppob/retry` | POST | session |
| **refunds** | `/refunds` | GET, POST | session |
| | `/refunds/:id` | GET | session |
| **stock** | `/stock/writeoffs` | GET, POST | session, alasan `lost` perlu admin |
| | `/stock/writeoffs/:id` | GET session, DELETE admin | |
| | `/stock/writeoffs/:id/approve`, `/reject` | POST | admin |
| **shifts** | `/shifts` | POST | session |
| | `/shifts/active` | GET | session |
| | `/shifts/:id/close`, `/shifts/:id/summary` | POST, GET | session |
| | `/shifts/:id/cash-flows` | GET, POST | session |
| | `/cash-flows/:id` | DELETE | pemilik atau admin |
| **reports** | `/reports/sales/{daily,monthly,period,receipts}` | GET | session |
| | `/reports/payment-methods`, `/reports/products/{sales,popular}` | GET | session |
| | `/reports/returns`, `/reports/stock/current`, `/reports/losses`, `/reports/cash-flows` | GET | session |
| **dashboard** | `/dashboard/{summary,revenue/daily,payment-methods,products/top,products/low-stock,transactions/recent}` | GET | session |
| **backup** | `/backups` | GET, POST | admin |
| | `/backups/:filename` | DELETE | admin |
| | `/backups/:filename/restore` | POST | admin |
| | `/backups/status` | GET | admin |
| | `/backups/export` | GET | admin, unduhan file |
| | `/backups/import` | POST | admin, unggahan multipart |
| **printing** | `/printers`, `/printers/settings` | GET | session |
| | `/printers/settings` | PUT | admin |
| | `/printers/test`, `/transactions/:id/print` | POST | session |
| | `/transaction-items/:id/ppob/print` | POST | session, cetak ulang struk PPOB satu baris |
| **ppob** | `/ppob/session` | POST | admin |
| | `/ppob/balance`, `/ppob/menu` | GET | session |
| | `/ppob/catalog/*` | GET | session |
| | `/ppob/inquiries/{pln,pdam,bpjs,pp,transfer,emoney}` | POST | session |
| | `/ppob/payments`, `/ppob/topups` | POST | session, wajib `Idempotency-Key` |
| | `/ppob/history`, `/ppob/history/:trxId`, `/ppob/mutasi` | GET | session |
| | `/ppob/notifications`, `/:inboxId/read`, `/read-all` | GET, POST | session |
| **logging** | `/logs` | POST | session |

## Sembilan operasi yang terikat mesin, bukan API

`list_printers`, `print_receipt`, `test_print`, `save_template_file`, `export_database`, `import_database`, `restore_backup`, `get_log_dir`, `get_data_dir` semuanya bekerja pada perangkat keras atau filesystem PC kasir.

Dalam arsitektur yang dipilih ini tidak jadi masalah: server berjalan di PC kasir yang sama dengan printer. Tapi tiga di antaranya berubah bentuk karena tidak ada lagi dialog file Tauri — export jadi unduhan, import dan template jadi unggahan atau unduhan HTTP, dan nama file dari client tidak pernah lagi dipakai sebagai path.

## Error

`AppError` sekarang diserialisasi jadi string telanjang, sehingga frontend terpaksa mencocokkan substring — ada satu tempat yang benar-benar memeriksa `message.includes("belum dikonfigurasi")`. Varian yang sudah ada dipetakan langsung:

| Varian | HTTP |
|---|---|
| `Auth` | 401 |
| `Forbidden` | 403 |
| `NotFound` | 404 |
| `Validation` | 422 |
| `Database`, `Internal` | 500, pesan aslinya dicatat ke log, bukan dikirim ke client |

Body error: `{ "code": "...", "message": "..." }`. Pesan untuk pengguna tetap bahasa Indonesia; `code` yang dibaca kode.

## Ketidakcocokan tipe yang harus dibereskan

`ReceiptData` di TypeScript tidak mendeklarasikan `subtotal_amount` dan `discount_amount` yang dikirim backend, sehingga struk HTML tidak pernah bisa menampilkan baris diskon. `product-table.tsx` mendeklarasikan `product_id` pada hasil `get_popular_products`, padahal `#[serde(flatten)]` membuat field itu tidak pernah ada — kodenya kebetulan benar karena memakai `id`. `TransactionItem` didefinisikan dua kali dengan bentuk berbeda dan versi di `transactions/types.ts` kehilangan `ppob_flag_id`. Kedua definisi `Transaction` kehilangan `shift_id`. Di seluruh tipe TS, `created_at`, `updated_at`, `min_stock`, dan `change_amount` dideklarasikan non-null padahal `Option<T>` di Rust. `AppSettingsWithPpob` kehilangan key `backup`.

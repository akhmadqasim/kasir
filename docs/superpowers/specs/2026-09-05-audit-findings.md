# Register Temuan Audit — 2026-09-05

Hasil audit enam jalur paralel terhadap `worktree-web-heroui` (basis `origin/master` e37807f + dua commit lokal yang di-cherry-pick).
Semua temuan ditelusuri lewat pembacaan kode, bukan eksekusi. ID di sini dipakai sebagai referensi commit perbaikan.

Ringkasan: **7 critical, 19 high, 31 medium, 24 low**, ditambah daftar dependency mati dan duplikasi.
Tiga agent independen menemukan B01 secara terpisah — itu temuan dengan keyakinan tertinggi.

---

## CRITICAL

| ID | Area | Lokasi | Masalah |
|---|---|---|---|
| **B01** | reports | `commands/reports.rs:214-226`, `:271-283` | `SUM(t.total_amount)` diagregasi di atas `LEFT JOIN transaction_items`, jadi total transaksi dijumlah sekali **per item**. Struk Rp 100.000 berisi 3 item dilaporkan Rp 300.000. `COUNT(DISTINCT t.id)` benar, jadi laporan bertentangan dengan dirinya sendiri, dan berbeda jauh dari Dashboard yang menghitung tanpa join. Merembet ke `report_sales_period` termasuk `avg_per_transaction`. |
| **B02** | ppob | `commands/ppob/payment.rs:12`, `inquiry.rs:383`, 13 command di `menu.rs`, 3 di `history.rs`/`notifications.rs` | Tidak satu pun command PPOB memanggil `require_role`/`require_auth` atau menerima identitas. `ppob_confirm_payment` menarik PIN PPOB dari `store_info` lalu memanggil `transfer-uang/payment` di API Mitra. Begitu HTTP aktif, satu request dari HP mana pun di LAN = uang riil keluar, tanpa jejak di tabel `transactions`. |
| **B03** | settings | `commands/settings.rs:264`, deobfuscation `:203-204` | `get_app_settings` tanpa guard dan sengaja men-deobfuscate `ppob.password` + `ppob.pin` sebelum dikirim ke client. Dipanggil dari layar kasir (`ppob-quick-access.tsx:157`). Satu request tanpa login = kredensial finansial toko. |
| **B04** | backup | `commands/backup.rs:407` (`delete_backup`), `:374`+`:392` (`restore_backup`) | `filename` mentah dari client masuk ke `Path::join`, yang **mengganti** base bila argumennya absolut. `delete_backup` bisa menghapus `kasir.db` produksi; `restore_backup` bisa menjadikan file gzip mana pun sebagai database aktif, lalu `fs::write` menimpanya **selagi pool sea-orm masih memegang file itu terbuka**. |
| **B05** | products | `features/products/components/import-dialog.tsx:293-296` | `parseFloat(String(v).replace(/[^\d.-]/g,""))` memperlakukan titik sebagai desimal. Harga `14.000` dari file supplier jadi **Rp 14**; `2500,5` jadi 25005. Lolos validasi backend. Satu import merusak seluruh katalog harga. |
| **B06** | cashier/ppob | `features/cashier/components/ppob-quick-access.tsx:192-202`, pemanggil `:522`, `:678`, `:835`, `:964` | Child mengirim `price` (tagihan + admin) **dan** `buy_price` (tagihan saja); handler mengabaikan `price` dan menghitung harga jual dari `buy_price` dengan markup default 0. Token PLN 20.000 + admin 2.500 dijual **20.000**. Toko rugi biaya admin di setiap transaksi PLN/PDAM/BPJS. |
| **B07** | settings | `features/settings/components/data-tab.tsx:259-288`, kembar di `:228-257` | Satu blok `try` membungkus dialog file **dan** `invoke("import_database")`. Kalau invoke gagal, `catch` jatuh ke fallback yang meng-import isi textbox, lalu menampilkan toast **sukses**. File yang tidak dipilih user menimpa database produksi, dan user diberi tahu berhasil. |

---

## HIGH

| ID | Area | Lokasi | Masalah |
|---|---|---|---|
| **B08** | cashier | `payment-dialog.tsx:195-206`, `:554` | Fokus terkunci di input nominal. Scanner adalah keyboard: digit barcode masuk sebagai nominal, Enter dari scanner memicu konfirmasi. Transaksi tersimpan dengan `payment_amount` 13 digit dan kembalian sebesar itu. |
| **B09** | cashier | `cashier-page.tsx:42-55` | `clear()` hanya dipanggil dari tombol "Transaksi Baru". Pindah halaman atau tekan F6 setelah bayar meninggalkan barang yang sudah dibayar di keranjang (dan di localStorage) → risiko tagih dua kali. |
| **B10** | cashier | `transaction-success-dialog.tsx:52-76` | `setTimeout(onNewTransaction, 1500)` tanpa cleanup. Kasir yang langsung memulai transaksi berikutnya kehilangan keranjang barunya saat timer meletus. |
| **B11** | cashier | `cart-panel.tsx:119-161` | Guard `anyDialogOpen` tidak tahu dialog milik `CashierPage`. F3 saat dialog sukses terbuka menyimpan keranjang **yang sudah dibayar** sebagai held cart yang bisa ditagih ulang; F9 menukar keranjang di tengah pembayaran. |
| **B12** | cashier | `use-cart-store.ts:271-328` | `itemDiscounts` dan `transactionDiscount` global, bukan per keranjang. Simpan keranjang berdiskon 50% → pelanggan berikutnya ikut mendapat diskon itu. |
| **B13** | refunds | `commands/refunds.rs:262-302`, `:330-397` | `product_id` dari client tidak pernah dicocokkan dengan `transaction_item`. Refund sabun sambil mengirim id beras menaikkan stok beras dari udara, dan untuk kondisi `damaged` menulis kerugian sebesar harga modal beras. |
| **B14** | refunds | `commands/refunds.rs:298`, `:336`; `use-refund-form.ts:120` | Refund memakai `product_price × quantity`, mengabaikan `item_discount` dan `discount_amount`. Barang Rp 50.000 berdiskon Rp 10.000 (dibayar 40.000) direfund **Rp 50.000**. |
| **B15** | refunds | `commands/refunds.rs:201-206` | Hanya status `refunded` yang diblokir. Transaksi yang sudah di-void tetap bisa direfund → stok naik dua kali, status `deleted` tertimpa `refunded`, struk tercetak Rp 0. |
| **B16** | transactions | `commands/transactions.rs:852-907` | `retry_ppob_fulfillment` membaca status lalu menulis "pending" dengan `await` di antaranya, menerima status "pending" untuk retry, dan memanggil provider tanpa idempotency key. Dua klik = dua topup untuk satu penjualan. |
| **B17** | auth | `commands/auth.rs:199-202` | `update_user` tidak mencegah admin terakhir mendemosi dirinya sendiri. Jumlah admin nol = aplikasi terkunci permanen, hanya bisa dipulihkan lewat edit DB manual. |
| **B18** | settings | `commands/settings.rs:380-391` | `export_database` menyalin file tanpa checkpoint WAL. Transaksi hari itu masih di `-wal` dan tidak ikut. Ini justru alur yang dianjurkan banner UI untuk pindah versi. |
| **B19** | settings | `commands/settings.rs:393-409` | `import_database` tidak menghapus sidecar `-wal`/`-shm`. WAL lama di-replay di atas database baru saat restart → data impor tertimpa atau korup. Tidak ada validasi header `SQLite format 3`. |
| **B20** | settings | `commands/settings.rs:339-377` | `change_user_pin` tanpa `caller_id` sama sekali dan tidak memfilter `is_active`. Error dibedakan antara "PIN saat ini salah" dan "PIN baru tidak valid" → oracle bersih untuk menebak PIN admin. |
| **B21** | auth | `commands/auth.rs:18-37` | Login tanpa rate limit, tanpa lockout, tanpa pencatatan kegagalan. PIN minimum 4 digit = ruang 10.000. Username tidak dikenal balik instan tanpa `bcrypt::verify` → enumerasi user lewat timing. |
| **B22** | stock | `commands/stock.rs:69-73`, `:314` | Satu-satunya tempat di backend yang menulis `created_at` dengan `Local::now()`; semua pembacanya mengkonversi tanggal lokal ke UTC. Write-off setelah pukul 17:00 WIB masuk laporan hari berikutnya. Kolom yang sama diisi UTC oleh jalur refund. |
| **B23** | shifts | `commands/shifts.rs:265` | `expected_cash` tidak mengurangi refund tunai. Tabel `refunds` bahkan tidak punya `shift_id`. Laci fisik benar tapi laporan tutup kasir menuduh selisih kurang. |
| **B24** | reports | `commands/reports.rs:667-682`, `:707-730` | `report_losses` tidak memfilter status, jadi write-off yang **ditolak** (stoknya sudah dikembalikan) dan yang masih `pending` tetap dihitung sebagai kerugian. |
| **B25** | products | `commands/products.rs:557-565` | Import mencocokkan produk existing hanya lewat barcode. Baris tanpa barcode selalu insert baru → import ulang file yang sama menggandakan katalog. |
| **B26** | printing | `printing/windows_printer.rs:216-218` | `DeleteObject` dipanggil sebelum `DeleteDC` sementara font masih ter-select di DC; Windows menolak, return value diabaikan. Setiap struk membocorkan 1-2 GDI object dari kuota 10.000 per proses. |
| **B27** | receipt | `features/receipt/utils/print-receipt.ts:240`, `:398-428` | Nama produk, catatan, dan footer disisipkan mentah ke HTML lalu `document.write` ke iframe same-origin. Dengan `csp: null` dan `withGlobalTauri: true`, script yang tersuntik menjangkau seluruh command. Latent: fungsi ini belum dipakai. |

---

## MEDIUM

Ringkas per area. Detail lengkap ada di transkrip audit.

**Transaksi & uang** — `create_transaction` terdaftar di IPC tapi executor PPOB-nya selalu gagal, sehingga checkout lewat jalur itu menagih pelanggan tanpa mengirim pulsa (`transactions.rs:837-849`). Harga di keranjang FE bisa berbeda dari harga server saat checkout, menghasilkan kembalian salah atau penolakan diskon (`transactions.rs:222-247`). Split tunai yang seluruhnya tertutup non-tunai tetap menyimpan baris pembayaran Rp 0 dan memaksa metode `mixed`. `per_page: 0` membuat `total_pages` jadi `u64::MAX`. Nomor struk memakai UTC sementara semua laporan mengelompokkan per tanggal lokal, jadi penjualan 06:30 WIB membawa tanggal kemarin. `delete_transaction` dan `update_payment_method` melewatkan cek `is_active`, jadi admin yang sudah dinonaktifkan tetap bisa void transaksi. Transaksi `mixed` tidak bisa diubah metode pembayarannya dan pesan errornya membingungkan.

**Refund** — refund penuh yang dikirim sebagai dua baris untuk item yang sama menyisakan status `partial_refund` permanen, dan transaksi itu terus dihitung penuh di laporan. Refund menghapus penjualan dari shift **asal**, bukan shift yang membayar tunai keluar. `maxQty` di UI memakai qty pembelian asli, bukan sisa yang bisa diretur. Aturan 7 hari tidak dicek di frontend dan di backend efektif ~8 hari karena `num_days()` memotong ke bawah; transaksi dengan `created_at` NULL melewati aturan itu sepenuhnya. Item PPOB muncul di daftar refund lalu gagal dengan pesan deserialisasi mentah. `RefundResult` yang dikembalikan untuk exchange selalu berisi selisih 0.

**Produk & stok** — barcode/SKU duplikat memunculkan error SQLite mentah tanpa jalan keluar dari UI, termasuk untuk produk yang sudah dihapus (soft delete tetap memegang barcode). Sorting produk tanpa tiebreaker membuat pagination mengulang dan melewati baris. Quick filter `needs_review` cocok dengan hampir seluruh katalog karena `min_stock <= 0` selalu benar. Definisi "stok menipis" berbeda di empat tempat. `delete_category` hanya menghitung produk aktif lalu gagal dengan FK error. Edit kategori menghapus deskripsinya. Write-off oleh kasir dipaksa `pending` walau untuk alasan rusak/kadaluarsa, bertentangan dengan aturan bisnis, dan toast tetap bilang berhasil. Mutasi write-off tidak menginvalidasi `search_products` sehingga stok yang ditampilkan basi. Teks konfirmasi approve write-off salah menjelaskan apa yang terjadi pada stok.

**Laporan & dashboard** — penjualan PPOB digabung jadi satu baris produk palsu karena `GROUP BY ti.product_id` tanpa filter NULL. "Transaksi Terbaru" di dashboard menampilkan transaksi yang sudah di-void. `get_weekly_stats` mencakup 8 hari sementara grafiknya 7 hari. Laporan "Penjualan per Struk" tidak memfilter status. `LIMIT 500` memotong data diam-diam. Klik dua kali pada tanggal yang sama membuat rentang jadi undefined dan laporan kosong tanpa error.

**Pengaturan & backup** — menyimpan setting saat data belum termuat menghapus kredensial PPOB. Footer struk tidak bisa dikosongkan. Tombol tambah nominal custom PPOB tidak berfungsi. Setting interval backup terlihat tidak tersimpan. `restore_backup` tidak memicu restart. Scheduler backup panic bila `interval_hours` nol dan mati diam-diam. `retention_days` negatif menghapus backup yang baru dibuat. Nama backup per tanggal membuat snapshot sehat tertimpa versi yang sudah rusak. Parsing nama backup panic pada `kasir_.db.gz` dan nama non-ASCII. `deobfuscate` panic pada input hex ganjil. `obfuscate` adalah XOR dengan kunci hardcoded, bukan enkripsi; token Mitra bahkan disimpan plaintext.

**Auth & sesi** — sesi tidak pernah disinkronkan ulang dengan DB, jadi role yang berubah tidak berpengaruh sampai relogin. Tidak ada role guard di level router: kasir melihat menu admin, mengisi form lengkap, lalu ditolak backend. Keranjang tidak dibersihkan saat logout. Shift basi dari localStorage tetap dipakai saat fetch gagal. `open_shift` diam-diam mengembalikan shift lama sambil menampilkan toast berhasil. Command shift tidak punya guard sama sekali. Onboarding bisa dibalap dan setelah sukses melempar user kembali ke halaman onboarding.

**Waktu** — `new Date("YYYY-MM-DD HH:MM:SS")` tanpa `Z` di enam layar membuat tanggal meleset tujuh jam; polanya sudah benar di `transactions-page.tsx:52` tapi tidak dipakai ulang.

---

## LOW

Label metode pembayaran tidak lengkap di beberapa layar (`debit`, `mixed` tampil mentah). Total held cart mengabaikan diskon. Tombol tambah PPOB tanpa guard klik ganda. `save_template_file` lolos untuk path drive-relative Windows. `bulk_create_products` menerima stok negatif dan menghidupkan kembali produk yang sudah dihapus. Wildcard LIKE tidak di-escape. Kontrak `total_pages` tidak konsisten antar modul. Buffer `Vec<u8>` di-cast ke `*const PRINTER_INFO_2W` yang beralignment 8. `list_printers` hanya menampilkan printer lokal, bukan printer jaringan. Struk panjang terpotong karena tidak ada page break. Waktu backup dipalsukan dari nama file. Cache notifikasi PPOB tidak di-invalidate saat kredensial diganti. Error SQL dan respons mentah API Mitra diteruskan ke UI. Qty write-off bertipe integer sehingga produk satuan kg tidak bisa ditulis 0,5. Non-null assertion `user!.id` di 17 tempat. Onboarding tidak punya field logo meski disebut di spesifikasi. `xlsx@0.18.5` punya CVE prototype-pollution dan ReDoS, sementara aplikasi mem-parse spreadsheet dari luar.

---

## Kontrak FE↔Rust

Tidak ada mismatch yang memutus runtime; seluruh command yang dipanggil terdaftar. Yang perlu dibereskan:

- `ReceiptData` di TS tidak mendeklarasikan `subtotal_amount`/`discount_amount` yang dikirim backend, sehingga struk HTML tidak pernah menampilkan diskon dan baris item tidak menjumlah ke total. Versi ESC/POS sudah benar — dua renderer struk sudah menyimpang.
- Beberapa tipe FE menyatakan `number`/`string` untuk field yang di Rust `Option<T>`: `min_stock`, `created_at`, `updated_at`, `change_amount`. `product-table.tsx:131` melakukan `stock <= null` yang selalu `false`.
- `get_popular_products` mengembalikan `#[serde(flatten)]` sehingga `product_id` yang ditulis di tipe FE tidak pernah ada di JSON.
- `update_printer_settings` adalah satu-satunya DTO tanpa `rename_all`; menambahkannya nanti akan membuat semua field jadi `None` diam-diam.
- `src/lib/types.ts` mendeklarasikan `PaymentMethod` dengan empat nilai lama tanpa `debit`/`mixed`, dan tidak diimpor di mana pun.

---

## Dependency mati (nol pemakaian)

`@tanstack/react-table`, `react-hook-form`, `@hookform/resolvers`, `zod`, `@dnd-kit/core`, `@dnd-kit/modifiers`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `vaul`, `@tauri-apps/plugin-shell`, dan `shadcn` (CLI, salah tempat di `dependencies`).

Catatan penting: **tidak ada satu pun schema zod atau react-hook-form di codebase** — semua form ditulis tangan dengan `useState` + validasi manual. Migrasi UI adalah kesempatan memasukkan validasi berbasis schema yang selama ini absen.

Komponen UI tanpa pemakai: `ui/drawer.tsx`, `ui/toggle-group.tsx`, `ui/pagination.tsx`, `ui/breadcrumb.tsx`.
Kode mati lain: `useWeeklyStats` + command `get_weekly_stats`, `src/app/start-page.tsx` (route tidak pernah dinavigasi), `usePpobPayment`, `printReceipt` (479 baris), `getCartValidationError`/`getAddItemValidationError` yang selalu mengembalikan `null` tapi tetap dipanggil di tiga tempat.

---

## Duplikasi terbesar

Blok date-range picker 35 baris disalin **10 kali**. `formatRupiah` didefinisikan ulang di 6 file meski `lib/format.ts` sudah ada. `formatDate` diduplikasi di 8 file dengan **dua implementasi berbeda** — itulah sumber bug tanggal meleset tujuh jam. `PAYMENT_LABELS` bercabang jadi 5 versi. Helper konversi tanggal lokal ke UTC ditulis ulang 5 kali di backend, salah satunya beroperasi pada kolom dengan timezone berbeda. `load_payment_breakdown` diimplementasikan 3 kali. Tiga generator nomor dokumen menyalin query yang sama dengan basis timezone yang berbeda-beda.

---

## Implikasi untuk rencana fase

1. **Session server-side harus dikerjakan lebih dulu.** B02, B03, B04, B13, B16, B17, B20, B21 semuanya berakar pada identitas yang datang dari client. Menambal satu per satu hanya memindahkan masalah. Menghapus `caller_id` dari signature membuat kompiler menunjukkan setiap tempat yang perlu diperbaiki.
2. **B01 tidak akan tertangkap test yang ada** karena tidak ada satu pun test untuk `reports.rs` dan `dashboard.rs`. Tulis test dengan satu transaksi tiga item untuk mengunci nilai revenue sebelum menyentuh SQL-nya.
3. **Standarkan timezone sebelum yang lain**, berikut migrasi data untuk `stock_writeoffs` (B22). Refactor tanpa migrasi itu justru mengunci bugnya.
4. **Persist harga setelah diskon per baris.** B14 dan B01 sama-sama muncul karena uang dihitung ulang di lima tempat yang saling tidak setuju.
5. **Fulfillment PPOB butuh outbox dengan idempotency key**, bukan `tokio::spawn` yang hilang saat aplikasi ditutup.
6. **`max_connections(1)` sedang menopang kebenaran.** Beberapa komentar di kode mengasumsikan akses terserialisasi. Menaikkan pool untuk melayani banyak klien HTTP akan membuka race yang selama ini tertutup, terutama pada generator nomor struk dan pengecekan stok exchange.

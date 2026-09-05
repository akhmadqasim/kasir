# Status pengerjaan refactor

Berkas kerja. Diperbarui setiap gelombang selesai. Rencana lengkap ada di
`2026-09-05-web-mode-heroui-refactor-design.md`, temuan di `2026-09-05-audit-findings.md`,
kontrak HTTP di `2026-09-05-http-api-contract.md`.

## Aturan jalur

Dua jalur berjalan bersamaan karena toolchain-nya terpisah dan direktorinya tidak
bersinggungan: jalur Rust menyentuh `src-tauri/`, jalur frontend menyentuh `src/`.
**Tidak pernah ada dua build pada toolchain yang sama sekaligus**, dan setiap commit
memakai path eksplisit (`git commit -- <paths>`) supaya tidak menyapu berkas jalur lain.

Nomor migrasi berikutnya yang bebas: **023**.

## Gerbang

| Gerbang | Awal | Sekarang |
|---|---|---|
| `cargo test --lib` | 39 | 268 |
| `bun run test` | 123 | 357+ |
| `bunx tsc -b` | bersih | bersih |
| `bun run lint` | 5 error, 2 warning | **0 error, 0 warning** |
| `cargo clippy --lib` | 21 warning | 10 warning, semuanya pre-existing |

Vitest dibatasi `maxWorkers: "50%"`. Satu worker per core membuat file test berebut CPU
sampai `findBy*` kehabisan waktu, dan file yang gagal berpindah tiap run. Setengah core
justru lebih cepat karena tidak ada waktu terbuang untuk saling menunggu.

## Fase

| Fase | Isi | Status |
|---|---|---|
| P0 | Perbaikan bug dari audit | selesai |
| P1 | Ekstrak `domain/` + `services/` dari `commands/` | selesai |
| P2 | axum, session server-side, seluruh route, static embed | selesai |
| P3 | Frontend: API client, browser router, auth lewat `/me` | **belum** |
| P4 | Migrasi HeroUI per halaman | gelombang terakhir berjalan |
| P5 | Pembersihan menyeluruh, dokumentasi, gerbang hijau serentak | belum |

Setelah P3, layer `commands/` dan 113 Tauri command dihapus seluruhnya.

## Kondisi backend

`services/` memegang seluruh business logic dan terbukti bersih dari `tauri` maupun
`axum`. Seluruh API tersedia di `src-tauri/src/http/` dengan sesi server-side; identitas
selalu datang dari cookie, tidak pernah dari isi request. `Actor::unverified` tinggal ada
di `commands/`, dan hilang bersama layer itu di P3.

Mode web masih opt-in lewat `KASIR_WEB_MODE=1` karena frontend belum memakai `fetch`.
Menyalakannya sekarang memberi server yang jalan dan jendela kosong — berguna untuk
menguji API dengan `curl`, belum untuk kasir.

## Sisa yang harus dikerjakan jalur frontend

Semua berasal dari perubahan backend yang sudah masuk.

1. **Status PPOB `processing`** perlu entri di `PPOB_STATUS_CONFIG`, dan `ppobCanRetry`
   harus jadi `failed` saja — `pending` kini ditolak backend.
2. **`net_subtotal`** ada di item transaksi; pakai untuk menampilkan baris berdiskon.
3. **`payment_breakdown` bisa tanpa baris tunai** kalau pembayarannya seluruhnya non-tunai.
4. **`ShiftSummaryResponse.cashRefunds`** baru; `expectedCash` sudah dikurangi angka itu.
5. **`ReceiptRow.refundAmount` dan `netAmount`** baru. Daftar struk kini **menampilkan
   struk berstatus `refunded`**; kalau UI menjumlahkan kolom, jumlahkan `netAmount`.
6. **`refunds.shift_id`** baru di model refund.
7. **Angka laporan berubah jadi bersih.** `PaymentMethodRow` bisa muncul dengan
   `transactionCount: 0` dan nominal negatif untuk metode yang periode itu hanya kena
   retur; `ProductSalesRow.qtySold` bisa nol atau negatif.
8. **`GET /api/settings` tidak lagi mengirim kredensial PPOB** — hanya `hasCredentials`.
   Tulis kredensial lewat `PUT /api/settings/ppob/credentials`.

## Keputusan yang sudah diambil dan alasannya

**Basis git.** Worktree bercabang dari `origin/master` (v0.5.0, 11 Juli), bukan master
lokal. Dua commit lokal 23 Juni sudah di-cherry-pick; konfliknya di `payment-dialog.tsx`
diselesaikan dengan mengambil `isSingleCashSelection` dari sisi lokal, karena sisi origin
sudah menghapus deklarasi `hasChangedPrimaryPaymentMethod` sehingga tidak akan compile.

**Laporan memakai angka bersih** atas permintaan pemilik toko. Retur dipotong di **hari
retur itu sendiri**, bukan hari penjualan, supaya laporan hari yang sudah dicetak tidak
berubah belakangan dan angkanya cocok dengan isi laci. Konsekuensinya status `refunded`
tidak lagi disembunyikan dari laporan penjualan — kalau disembunyikan sekaligus dipotong,
uangnya terhitung hilang dua kali.

**Bug auth tidak ditambal satu per satu di P0.** Menghapus `caller_id` dari signature saat
session masuk membuat kompiler menunjukkan setiap tempat yang perlu diperbaiki.

**Idempotency key ke Mitra tidak mungkin** — kontrak API-nya tidak punya parameter itu.
Yang dipakai: state `processing` dengan conditional update. Untuk layanan tagihan
`inquiry_id` sudah jadi dedupe alami di sisi provider; untuk pulsa dan data tidak ada.

**ESC menutup dialog di semua tempat.** HeroUI mematikannya secara default di sebagian
overlay, sedangkan Radix dulu mengaktifkannya dan kasir terbiasa memakainya.

**Token `--muted` dan `--accent` diserahkan ke HeroUI.** Kedua sistem memakai nama yang
sama untuk arti yang berbeda, jadi sisi shadcn dipindah ke `bg-default`.

**`shadcn` tetap jadi dependency.** Bukan CLI murni — `src/index.css` mengimpor
`shadcn/tailwind.css`, dan mencabutnya mematikan build CSS. Dipindah ke `devDependencies`.

## Batasan yang diketahui, bukan bug

**Cara refund dibayarkan tidak tercatat.** `refunds.payment_method` disalin dari transaksi
asal, jadi refund tunai atas penjualan QRIS tidak terlihat sebagai kas keluar, dan
sebaliknya. `mixed` sengaja tidak dihitung sebagai tunai karena porsi tunainya tidak ada
datanya — menebak berarti menaruh angka karangan di laporan tutup kasir.

**Backfill `refunds.shift_id`** tidak bisa memulihkan refund yang diambil tanpa shift
terbuka, refund oleh kasir lain atas laci yang sama, atau shift yang tidak pernah ditutup.

**Backfill `net_subtotal`** tidak bisa memisahkan diskon item dari diskon transaksi untuk
baris lama, karena `discount_amount` mencampur keduanya tanpa jejak pembagiannya.

**Barang pengganti exchange tidak ditulis ke `transaction_items`.** Laporan menanganinya
dengan menjumlahkan balik dari `exchange_items`; menuliskannya sebagai penjualan sungguhan
adalah keputusan produk yang belum diambil.

**Verifikasi visual belum pernah dilakukan.** Aplikasi masih boot lewat Tauri command, dan
ekstensi Chrome meminta manusia memilih di antara dua browser yang terhubung. Semua bukti
sejauh ini berasal dari test, bukan dari mata. Setelah P3 aplikasi jalan di
`http://127.0.0.1:17720` dan pengecekan visual jadi mudah.

## Koreksi terhadap dokumen lain

`CLAUDE.md` menulis "Selisih positif → pelanggan bayar", padahal kodenya menghitung
`total_refund_amount - total_exchange_amount` sehingga selisih positif berarti toko yang
membayar. Kodenya konsisten dan sudah dikunci test; **dokumennya yang terbalik**, dan
diperbaiki di P5.

Jumlah Tauri command yang benar adalah **113** setelah `create_transaction` dicabut.

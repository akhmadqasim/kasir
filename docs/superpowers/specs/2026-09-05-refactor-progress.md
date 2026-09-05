# Status pengerjaan refactor

Berkas kerja. Diperbarui setiap gelombang selesai. Rencana lengkap ada di
`2026-09-05-web-mode-heroui-refactor-design.md`, temuan di `2026-09-05-audit-findings.md`,
kontrak HTTP di `2026-09-05-http-api-contract.md`.

## Aturan jalur

Dua jalur berjalan bersamaan karena toolchain-nya terpisah dan direktorinya tidak
bersinggungan: jalur Rust menyentuh `src-tauri/`, jalur frontend menyentuh `src/`.
**Tidak pernah ada dua build pada toolchain yang sama sekaligus**, dan setiap commit
memakai path eksplisit (`git commit -- <paths>`) supaya tidak menyapu berkas jalur lain.

Nomor migrasi berikutnya yang bebas: **019**.

## Baseline dan posisi sekarang

| Gerbang | Awal | Sekarang |
|---|---|---|
| `cargo test --lib` | 39 | 78 |
| `bun run test` | 123 | 209 |
| `bunx tsc -b` | bersih | bersih |
| `bun run lint` | 5 error, 2 warning | 4 error, 2 warning |
| `cargo clippy --lib` | 21 warning | 21 warning |

Empat error lint yang tersisa semuanya `react-hooks/set-state-in-effect` di
`src/features/cashier/**`; memperbaikinya perlu restrukturisasi efek dan dijadwalkan
di fase pembersihan.

## Fase

| Fase | Isi | Status |
|---|---|---|
| P0 | Perbaikan bug dari audit | berjalan |
| P1 | Ekstrak `domain/` + `services/` dari `commands/` | belum |
| P2 | axum, session server-side, seluruh route, static embed | belum |
| P3 | Frontend: API client, browser router, auth lewat `/me` | belum |
| P4 | Migrasi HeroUI per halaman | persiapan berjalan |
| P5 | Pembersihan menyeluruh, dokumentasi, gerbang hijau serentak | belum |

## Sisa yang harus dikerjakan jalur frontend

Berasal dari perubahan backend yang sudah masuk. Belum dikerjakan.

1. **Status PPOB `processing`.** `transaction-detail-dialog.tsx:95` perlu entri baru di
   `PPOB_STATUS_CONFIG`, dan `:148` `ppobCanRetry` harus jadi `ppob_status === "failed"`
   saja. Status `pending` kini ditolak backend, jadi tombol retry yang masih menampilkannya
   akan memunculkan pesan validasi.
2. **`net_subtotal`** ditambahkan ke item transaksi di backend. Tambahkan ke
   `cashier/types.ts` dan `transactions/types.ts`, dan pakai untuk menampilkan baris
   berdiskon alih-alih `product_price * quantity`.
3. **`payment_breakdown` bisa tanpa baris tunai.** Pembayaran yang seluruhnya ditutup
   non-tunai kini bermetode metode itu sendiri, bukan `mixed`, dengan satu entri saja.
   Kode yang mengasumsikan entri tunai selalu ada harus menangani ketiadaannya.
4. **`product_id` di `use-refund-form.ts:151`** sudah diabaikan backend; non-null
   assertion-nya bisa dihapus.
5. **Harga di detail refund berubah makna** — kini harga satuan yang benar-benar dibayar,
   bukan harga daftar. Tidak ada perubahan tipe, tapi angkanya berbeda untuk penjualan
   berdiskon.

## Keputusan yang sudah diambil dan alasannya

**Basis git.** Worktree bercabang dari `origin/master` (v0.5.0, 11 Juli), bukan master
lokal. Dua commit lokal 23 Juni sudah di-cherry-pick; konfliknya di `payment-dialog.tsx`
diselesaikan dengan mengambil `isSingleCashSelection` dari sisi lokal, karena sisi origin
sudah menghapus deklarasi `hasChangedPrimaryPaymentMethod` sehingga tidak akan compile.

**Bug auth ditunda ke P2.** Semua temuan yang berakar pada identitas dari client tidak
ditambal di P0. Menghapus `caller_id` dari signature saat session masuk akan membuat
kompiler menunjukkan setiap tempat yang perlu diperbaiki — jauh lebih aman daripada
menambal satu per satu dan berisiko terlewat.

**Idempotency key ke Mitra tidak mungkin.** Kontrak API-nya tidak punya parameter itu;
menambah field karangan berarti mengarang kontrak upstream. Yang dipakai: state
`processing` dengan conditional update, sehingga satu baris hanya bisa diklaim sekali di
sisi kita. Untuk layanan tagihan, `inquiry_id` sudah jadi dedupe alami di sisi provider;
untuk pulsa dan data tidak ada. Akibatnya baris `pending` yang yatim karena aplikasi
ditutup di tengah fulfillment belum bisa di-retry — itu butuh outbox, dicatat sebagai
pekerjaan tersendiri.

**Backfill `net_subtotal` tidak bisa sempurna.** `discount_amount` mencampur diskon item
dan diskon transaksi tanpa jejak pembagiannya, dan baris sebelum migrasi 007 tidak punya
kolom diskon sama sekali. Backfill memakai `subtotal - COALESCE(item_discount, 0)`: tepat
untuk transaksi tanpa diskon level transaksi, dan untuk sisanya masih jauh lebih dekat
daripada perilaku lama yang mengabaikan seluruh diskon.

## Koreksi terhadap dokumen lain

`CLAUDE.md` menulis "Selisih positif → pelanggan bayar", padahal `refunds.rs` menghitung
`total_refund_amount - total_exchange_amount` sehingga selisih positif berarti toko yang
membayar. Kodenya konsisten dengan dirinya sendiri dan sudah dikunci test. **Dokumennya
yang terbalik** dan diperbaiki di P5, bukan perilakunya.

Jumlah Tauri command yang benar adalah **114**, bukan 117 seperti tertulis di catatan awal.

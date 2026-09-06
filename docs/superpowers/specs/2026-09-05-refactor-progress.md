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
| `cargo test --lib` | 39 | 258 |
| `bun run test` | 123 | 449 (40 berkas) |
| `bunx tsc -b` | bersih | bersih |
| `bun run lint` | 5 error, 2 warning | **0 error, 0 warning** |
| `bun run build` | berhasil | berhasil |
| `cargo clippy --lib` | 21 warning | **0 warning** |
| `cargo fmt --check` | — | bersih |

`cargo test --lib` turun dari 268 ke 258 di P5: 8 test milik `utils/auth_guard.rs`
dan 2 test milik `services::dashboard::weekly_stats` hilang bersama kode yang mereka
uji, bukan karena regresi.

Vitest dibatasi `maxWorkers: "50%"`. Satu worker per core membuat file test berebut CPU
sampai `findBy*` kehabisan waktu, dan file yang gagal berpindah tiap run. Setengah core
justru lebih cepat karena tidak ada waktu terbuang untuk saling menunggu.

## Fase

| Fase | Isi | Status |
|---|---|---|
| P0 | Perbaikan bug dari audit | selesai |
| P1 | Ekstrak `domain/` + `services/` dari `commands/` | selesai |
| P2 | axum, session server-side, seluruh route, static embed | selesai |
| P3 | Frontend: API client, browser router, auth lewat `/me` | selesai |
| P4 | Migrasi HeroUI per halaman | selesai |
| P5 | Pembersihan menyeluruh, dokumentasi, gerbang hijau serentak | selesai |

## Kondisi backend

`services/` memegang seluruh business logic dan terbukti bersih dari `tauri` maupun
`axum`. Seluruh API tersedia di `src-tauri/src/http/` dengan sesi server-side; identitas
selalu datang dari cookie, tidak pernah dari isi request.

Layer `commands/` dan seluruh Tauri command sudah dihapus di P5, bersama
`Actor::unverified`, `utils/auth_guard.rs`, dan `tauri-plugin-dialog`. `Actor` sekarang
hanya bisa dibangun dari sesi (`http::session`) atau, di test, lewat `Actor::new` yang
di-gate `#[cfg(test)]`. Mode web bukan lagi opt-in: `run()` selalu menjalankan server
axum lalu selalu mengarahkan jendela ke `http://127.0.0.1:<port>`; `KASIR_BIND=127.0.0.1`
tetap tersedia sebagai jalan keluar untuk membatasi ke akses lokal saja.

Penghapusan `commands/` menyeret beberapa kode mati yang tidak ada di daftar audit awal
tapi baru mati setelah pemangkasan: `services::backup::stage_restore_from_file` (hanya
dipakai `settings::import_database`, yang sendiri sudah mati dan ikut dihapus) dan
`Actor::new` (satu-satunya pemanggil non-test adalah `Actor::unverified`).

## Kondisi frontend

Tidak ada lagi `@tauri-apps` di `src/`. Satu klien `fetch` di `src/lib/api/client.ts`,
satu modul bertipe per resource di sebelahnya, dan kunci query terstruktur di
`src/lib/api/query-keys.ts`. `scripts/check-api-routes.mjs` mencocokkan setiap path yang
dipanggil klien dengan tabel rute axum — saat ini **112 rute, 112 terpakai, nol selisih
di kedua arah** (naik dari 111 karena `GET /api/settings/ppob/markup`).

Mode web adalah satu-satunya mode. `bun run build` lalu build Rust menghasilkan
`kasir.exe` yang langsung bisa dijalankan tanpa variabel lingkungan apa pun.

## Perbaikan P5

1. **Markup PPOB tidak terbaca kasir — diperbaiki.** `GET /api/settings/ppob/markup`
   ditambahkan ke grup `session`, mengembalikan hanya `PpobMarkup` (tidak ada
   `password`/`pin` di path mana pun). `PpobQuickAccess` sekarang memanggil endpoint ini,
   bukan `GET /api/settings`. Diverifikasi lewat test router (`a_cashier_can_read_the_ppob_markup_but_not_the_credentials`,
   `the_ppob_markup_route_requires_a_session`) dan lewat `curl` terhadap server yang benar-benar hidup.
2. **`commands/` dan seluruh Tauri command — dihapus.**
3. **`tauri-plugin-dialog` — dicabut**, dari `Cargo.toml`, `lib.rs`, dan
   `capabilities/default.json` (`dialog:allow-save`, `dialog:allow-open`).

## Verifikasi runtime (pertama kali aplikasi ini benar-benar dijalankan)

`bun run build` → `cargo build` → `kasir.exe` dijalankan dengan `KASIR_DATA_DIR` menunjuk
ke folder kerja. Terhadap server hidup di `http://127.0.0.1:17720`, dengan `curl`:

- Login dengan PIN salah → `401`, tanpa `Set-Cookie`. Login benar → `200` +
  `Set-Cookie: kasir_session=...; HttpOnly; SameSite=Lax; Path=/`.
- `GET /api/auth/me` → `200` dengan cookie, `401` tanpa cookie.
- `POST` tanpa header `Origin`/`Referer` → `403 {"code":"csrf"}`.
- Sesi kasir memanggil `/api/settings` atau `/api/users` (admin) → `403 forbidden`;
  memanggil `/api/settings/ppob/markup` → `200`.
- Path SPA yang tidak dikenal → `200` `index.html`; `/api/...` yang tidak dikenal →
  `404 {"code":"not_found"}`.
- `POST /api/transactions` dua kali dengan `Idempotency-Key` yang sama dan body yang
  sama → transaksi pertama `201`, yang kedua `201` + header `Idempotency-Replayed: true`,
  `id` dan `receipt_number` sama persis, dan `GET /api/transactions` menunjukkan hanya
  satu baris.
- Penjadwal backup berjalan sejak start-up (buktinya: `data/backups/*.db.gz` muncul
  otomatis tanpa dipicu klien mana pun) — mengonfirmasi pemindahan pemanggilan
  `run_scheduler` ke `lib.rs` tidak diam-diam berhenti bekerja.

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

**Verifikasi visual belum pernah dilakukan.** P5 membuktikan `kasir.exe` hidup dan
menjawab benar lewat HTTP end-to-end (lihat "Verifikasi runtime" di atas: login, sesi,
CSRF, role, fallback SPA, idempotency, semuanya lewat `curl` terhadap server yang
sungguhan jalan) — tapi itu belum sama dengan membuka jendela desktopnya dan memakai
layar kasir dengan mouse dan keyboard. Ekstensi Chrome untuk verifikasi visual meminta
manusia memilih di antara dua browser yang terhubung, jadi tidak ada agen yang bisa
membuka layarnya sendiri; bukti visual masih menunggu.

## Koreksi terhadap dokumen lain

`CLAUDE.md` menulis "Selisih positif → pelanggan bayar", padahal kodenya menghitung
`total_refund_amount - total_exchange_amount` sehingga selisih positif berarti toko yang
membayar. Kodenya konsisten dan sudah dikunci test; **dokumennya yang terbalik**. Belum
diperbaiki — di luar cakupan gelombang P5 ini (fokusnya bug markup PPOB, penghapusan
`commands/`, dan mode web default), jadi masih menunggu gelombang berikutnya.

Jumlah Tauri command yang benar adalah **113** setelah `create_transaction` dicabut, dan
sekarang **0** setelah P5 menghapus seluruh layer `commands/`.

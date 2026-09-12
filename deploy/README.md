# Deployment: akses aplikasi dari perangkat lain di LAN toko

Aplikasi berjalan dalam satu proses. Proses itu membuka database SQLite,
menjalankan HTTP server, lalu membuka jendela desktop yang menunjuk ke server
tersebut. Jendela desktop dan browser di perangkat lain memakai jalur kode yang
persis sama.

```
                    PC kasir (Windows)
   ┌───────────────────────────────────────────────┐
   │  kasir.exe                                    │
   │   ├── SQLite  (data/kasir.db, mode WAL)       │
   │   ├── axum    (0.0.0.0:17720)                 │
   │   ├── printer thermal (Windows GDI)           │
   │   └── jendela Tauri → http://127.0.0.1:17720  │
   └──────────────────┬────────────────────────────┘
                      │
                   nginx :80
                      │
        ┌─────────────┴──────────────┐
     tablet kasir              PC kantor
```

## Status: mode web selalu aktif

Frontend memakai `fetch` ke `/api` untuk semuanya; tidak ada Tauri command yang
tersisa, baik di sisi browser maupun di sisi Rust — lapisan `commands/` sudah
dihapus. Karena itu server dan jendela desktop tidak lagi punya jalur terpisah:
`kasir.exe` selalu menjalankan server, lalu jendela selalu memuat
`http://127.0.0.1:<port>`. Tidak ada variabel yang perlu diset untuk
menyalakannya.

Untuk `bun run dev`, SPA disajikan di `http://localhost:5173` dan Vite
mem-proxy `/api` ke `127.0.0.1:17720`. Origin yang sampai ke server tetap
`http://localhost:5173`, jadi jalankan aplikasinya dengan
`KASIR_ALLOWED_ORIGINS=http://localhost:5173` supaya request pengubah data
tidak tertolak oleh Origin check.

## Menjalankan

1. Jalankan `kasir.exe` di PC kasir. Server ikut hidup bersama aplikasi dan mati
   bersama aplikasi — tidak ada langkah tambahan untuk menyalakannya. Set
   `KASIR_BIND=127.0.0.1` bila PC ini tidak boleh diakses dari LAN sama sekali
   (lihat tabel variabel di bawah).
2. Port default **17720**. Kalau terpakai, aplikasi mencoba 17721 sampai 17729 dan
   menulis port final ke `data/logs/startup.log`.
3. Pasang nginx di PC yang sama (atau PC lain di LAN yang bisa menjangkau port itu),
   pakai berkas di `deploy/nginx/`.

## Variabel lingkungan

| Variabel | Default | Guna |
|---|---|---|
| `KASIR_PORT` | `17720` | Port pertama yang dicoba HTTP server |
| `KASIR_BIND` | `0.0.0.0` | Set ke `127.0.0.1` bila hanya ingin akses lokal |
| `KASIR_TRUST_PROXY` | tidak aktif | Set `1` hanya bila di belakang nginx. Mengaktifkan pembacaan `X-Forwarded-For`, `X-Forwarded-Proto`, dan `X-Forwarded-Host` |
| `KASIR_ALLOWED_ORIGINS` | kosong | Daftar origin tambahan (dipisah koma) yang boleh mengirim request pengubah data, di luar host request itu sendiri |
| `KASIR_DATA_DIR` | `%APPDATA%/com.kasir.pos` | Lokasi database, backup, dan log |

`KASIR_TRUST_PROXY` jangan diaktifkan kalau port aplikasi bisa dijangkau langsung
dari LAN tanpa melewati nginx. Kalau aktif, klien bisa memalsukan alamat IP-nya
sendiri lewat header dan lolos dari rate limit login.

## Sesi dan login

Identitas datang dari cookie sesi, bukan dari isi request. `POST /api/auth/login`
memverifikasi PIN lalu mengirim cookie `kasir_session` dengan `HttpOnly`,
`SameSite=Lax`, `Path=/`, dan `Secure` **hanya** bila request datang lewat HTTPS
(yaitu `KASIR_TRUST_PROXY=1` dan `X-Forwarded-Proto: https`). Yang disimpan di
database hanya hash SHA-256 dari token; tokennya sendiri tidak pernah ditulis ke
disk.

Masa aktif sesi mengikuti `security.session_timeout_minutes` di pengaturan
aplikasi (default 30 menit) dengan *sliding expiry*: setiap request menggeser
tenggatnya, ditulis paling sering sekali per menit.

**Login dibatasi.** Tiga percobaan gagal berturut-turut mengunci username *dan*
alamat IP yang bersangkutan selama 5 detik, lalu 10, 20, 40 detik dan seterusnya
sampai maksimum 15 menit. Hitungan direset oleh login yang berhasil, atau setelah
satu jam tanpa percobaan baru. Sisa waktu tunggu dikirim di header `Retry-After`.

## Origin check (CSRF)

Setiap request yang mengubah data (`POST`, `PUT`, `PATCH`, `DELETE`) wajib
menyertakan header `Origin` — atau `Referer` bila `Origin` tidak ada — yang
host-nya sama dengan host tujuan request. Request tanpa keduanya ditolak dengan
`403` dan `{"code":"csrf"}`.

Yang dibandingkan hanya `host[:port]`, bukan skema, supaya nginx dengan TLS di
depan tidak ikut tertolak. Bila nginx menyajikan aplikasi dengan nama yang tidak
sampai ke header `Host`, daftarkan nama itu di `KASIR_ALLOWED_ORIGINS`.

Konsekuensi praktis: menguji API dengan `curl` perlu header origin, misalnya

```sh
curl -i -X POST http://127.0.0.1:17720/api/auth/login \
  -H 'Origin: http://127.0.0.1:17720' \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","pin":"1234"}'
```

Request baca (`GET`, `HEAD`) tidak diperiksa.

## Idempotency-Key: tiga endpoint yang wajib memakainya

`POST /api/transactions`, `POST /api/ppob/payments`, dan `POST /api/ppob/topups`
**menolak** request yang tidak menyertakan header `Idempotency-Key`. Ketiganya
memindahkan uang, dan lewat HTTP ada satu kegagalan yang tidak ada di IPC:
penjualan tercatat, jawabannya hilang di jalan, lalu klien mengirim ulang.
Tanpa key, kirim ulang itu menjadi penjualan kedua.

Key-nya dipilih klien — satu UUID per keranjang, dibuat sekali dan dipakai untuk
setiap percobaan keranjang itu. Panjangnya 8–200 karakter ASCII.

| Keadaan | Jawaban |
|---|---|
| Key belum pernah dipakai | Pekerjaan dijalankan, `201` |
| Key sudah selesai, body sama | Hasil yang tersimpan, `201` + header `Idempotency-Replayed: true` |
| Key sudah selesai, body berbeda | `422` — key dipakai untuk permintaan lain |
| Key sedang diproses | `409 conflict` — tunggu percobaan pertama selesai |
| Percobaan sebelumnya gagal | Key bebas lagi, kirim ulang dengan key yang sama |

Yang disimpan di tabel `idempotency_keys` adalah `sha256(scope | user_id | key)`
sebagai primary key, digest body-nya, dan JSON jawabannya. Karena di-scope per
endpoint dan per pengguna, key yang sama dari dua terminal tidak pernah saling
memutar ulang. Baris kedaluwarsa setelah **24 jam** dan disapu oleh task per jam
yang sama dengan penyapu sesi.

## Ekspor dan impor database

Tidak ada nama berkas dari klien yang pernah menjadi path.

`GET /api/backups/export` (admin) menjalankan WAL checkpoint lalu **mengalirkan**
`kasir.db` sebagai unduhan. Nama di `Content-Disposition`
(`kasir-export-YYYY-MM-DD_HHMMSS.db`) dibuat server dari jamnya sendiri; itu
saran untuk folder unduhan browser, bukan path yang diproses aplikasi.

`POST /api/backups/import` (admin) menerima **multipart** dengan field bernama
`file`. Nama berkas yang dibawa bagian multipart itu diabaikan sepenuhnya. Isinya
diperiksa header SQLite-nya, lalu ditulis ke satu path staging di sebelah
database dan dipasang saat aplikasi dijalankan berikutnya — sama seperti restore
backup, dan karena alasan yang sama: pool koneksi masih memegang `kasir.db`.

`DELETE /api/backups/{filename}` dan `POST /api/backups/{filename}/restore`
menyusun ulang path dari direktori backup dan menolak apa pun yang bukan satu
komponen nama backup (`kasir_YYYY-MM-DD[_HHMMSS].db.gz`). `..`, path absolut,
dan pemisah yang di-percent-encode semuanya ditolak sebelum menyentuh filesystem.

## Pengaturan: kredensial PPOB tidak pernah dikirim

`GET /api/settings` (admin) **tidak** mengembalikan `ppob.password` dan
`ppob.pin`. Yang ada hanya `ppob.has_credentials` — `true` bila keduanya
tersimpan. `PUT /api/settings` juga tidak menerima keduanya; nilai yang sudah
tersimpan dipertahankan, jadi menyimpan pengaturan markup tidak mengosongkan
kredensial. Satu-satunya jalan mengubahnya adalah
`PUT /api/settings/ppob/credentials` (admin).

## Bentuk error

Semua kegagalan memakai bentuk yang sama: `{"code": "...", "message": "..."}`.
`message` berbahasa Indonesia untuk ditampilkan ke pengguna, `code` untuk dibaca
kode.

| `code` | HTTP | Kapan |
|---|---|---|
| `auth` | 401 | Belum login, atau sesi sudah tidak berlaku |
| `forbidden` | 403 | Sudah login, tapi tidak berhak |
| `csrf` | 403 | Origin/Referer tidak cocok atau tidak ada |
| `not_found` | 404 | Data atau endpoint tidak ada |
| `conflict` | 409 | `Idempotency-Key` yang sama masih diproses percobaan lain |
| `rate_limited` | 429 | Kena backoff login; lihat header `Retry-After` |
| `bad_request` | 400 | Body atau query tidak bisa diurai, atau `Idempotency-Key` hilang |
| `validation` | 422 | Body benar bentuknya, tapi melanggar aturan |
| `internal` | 500 | Kesalahan server. Detail aslinya masuk `data/logs/error.log`, tidak pernah dikirim ke klien |

## Firewall Windows

Izinkan port nginx (80), bukan port aplikasi. Kalau nginx berada di PC lain,
batasi akses ke port 17720 hanya dari alamat IP nginx tersebut.

## Yang perlu diketahui

**Printer thermal terikat ke PC kasir.** Perintah cetak dieksekusi oleh server,
jadi struk selalu keluar dari printer yang tercolok di PC kasir, dari mana pun
tombol cetak ditekan.

**Satu shift aktif untuk seluruh toko.** Beberapa terminal yang membuka aplikasi
bersamaan berbagi shift yang sama. Ini batasan yang diketahui, bukan bug.

**Tanpa TLS, trafik LAN berupa plaintext.** PIN kasir dan cookie sesi bisa dibaca
oleh siapa pun di jaringan yang sama. Untuk jaringan toko yang tertutup, ini
diterima. Untuk jaringan yang dipakai bersama pelanggan, aktifkan blok HTTPS di
`deploy/nginx/kasir.conf`.

**Backup tetap berjalan di server.** Penjadwal backup harian ada di dalam proses
aplikasi, tidak bergantung pada klien mana pun yang sedang terbuka.

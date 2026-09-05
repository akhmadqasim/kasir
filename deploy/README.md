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

## Status: mode web masih opt-in

> HTTP server-nya sudah ada, frontend-nya belum pindah. Sampai fase migrasi
> frontend selesai, `kasir.exe` **default-nya tetap desktop-only**: jendela
> memuat aset bawaan dan berbicara lewat Tauri command seperti sebelumnya, dan
> HTTP server tidak dijalankan sama sekali.
>
> Set `KASIR_WEB_MODE=1` untuk menyalakan server sekaligus mengarahkan jendela
> desktop ke `http://127.0.0.1:<port>`. Selama frontend belum memakai `fetch`,
> menyalakannya menghasilkan server yang jalan dan jendela yang kosong — berguna
> untuk menguji API dengan `curl`, belum untuk dipakai kasir.

## Menjalankan

1. Jalankan `kasir.exe` di PC kasir dengan `KASIR_WEB_MODE=1`. Server ikut hidup
   bersama aplikasi dan mati bersama aplikasi.
2. Port default **17720**. Kalau terpakai, aplikasi mencoba 17721 sampai 17729 dan
   menulis port final ke `data/logs/startup.log`.
3. Pasang nginx di PC yang sama (atau PC lain di LAN yang bisa menjangkau port itu),
   pakai berkas di `deploy/nginx/`.

## Variabel lingkungan

| Variabel | Default | Guna |
|---|---|---|
| `KASIR_WEB_MODE` | tidak aktif | Set `1` untuk menjalankan HTTP server dan mengarahkan jendela desktop ke server itu |
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
| `rate_limited` | 429 | Kena backoff login; lihat header `Retry-After` |
| `bad_request` | 400 | Body atau query tidak bisa diurai |
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

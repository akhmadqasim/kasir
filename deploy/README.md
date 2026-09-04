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

## Menjalankan

1. Jalankan `kasir.exe` di PC kasir seperti biasa. Server ikut hidup bersama aplikasi.
2. Port default **17720**. Kalau terpakai, aplikasi mencoba 17721 sampai 17729 dan
   menulis port final ke `data/logs/startup.log`.
3. Pasang nginx di PC yang sama (atau PC lain di LAN yang bisa menjangkau port itu),
   pakai berkas di `deploy/nginx/`.

## Variabel lingkungan

| Variabel | Default | Guna |
|---|---|---|
| `KASIR_PORT` | `17720` | Port HTTP server |
| `KASIR_BIND` | `0.0.0.0` | Set ke `127.0.0.1` bila hanya ingin akses lokal |
| `KASIR_TRUST_PROXY` | tidak aktif | Set `1` hanya bila di belakang nginx. Mengaktifkan pembacaan `X-Forwarded-For` dan `X-Forwarded-Proto` |
| `KASIR_DATA_DIR` | `%APPDATA%/com.kasir.pos` | Lokasi database, backup, dan log |

`KASIR_TRUST_PROXY` jangan diaktifkan kalau port aplikasi bisa dijangkau langsung
dari LAN tanpa melewati nginx. Kalau aktif, klien bisa memalsukan alamat IP-nya
sendiri lewat header dan lolos dari rate limit login.

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

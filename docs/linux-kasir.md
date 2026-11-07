# Menjalankan Kasir di Linux

Panduan untuk PC kasir dengan Ubuntu, Debian, atau Fedora (64-bit). Perintah di bawah
diketik di Terminal. Ganti `X.Y.Z` dengan nomor versi berkas yang diunduh, misalnya `1.4.1`.
Pengaturan printer dan data dilakukan dengan akun admin.

## 1. Memasang aplikasi

Unduh satu berkas dari https://github.com/akhmadqasim/kasir/releases/latest, lalu buka
Terminal di folder unduhan (`cd ~/Downloads` atau `cd ~/Unduhan`).

| Sistem          | Berkas                       | Perintah                                     |
| --------------- | ---------------------------- | -------------------------------------------- |
| Ubuntu / Debian | `kasir_X.Y.Z_amd64.deb`      | `sudo apt install ./kasir_X.Y.Z_amd64.deb`   |
| Fedora          | `kasir-X.Y.Z-1.x86_64.rpm`   | `sudo dnf install ./kasir-X.Y.Z-1.x86_64.rpm` |
| Lainnya         | `kasir_X.Y.Z_amd64.AppImage` | lihat di bawah                               |

Pilih .deb atau .rpm bila bisa. Paket ini sekaligus memberi izin ke printer USB.

AppImage hanya jalan di Linux yang baru (glibc 2.43 ke atas, misalnya Ubuntu 26.04 atau
Fedora 45). Untuk Ubuntu 22.04/24.04 dan Debian 12/13, pakai .deb. Di Fedora pasang juga
`libglvnd-gles` kalau jendela kasir tidak muncul.

AppImage tidak perlu dipasang. Simpan di folder tetap di folder rumah, misalnya
`~/Aplikasi`, lalu jalankan:

```bash
chmod +x kasir_X.Y.Z_amd64.AppImage
./kasir_X.Y.Z_amd64.AppImage
```

Kalau AppImage menolak jalan dan menyebut FUSE, pasang `libfuse2` (Ubuntu 24.04:
`libfuse2t64`, Fedora: `fuse-libs`). Jangan pindahkan berkasnya setelah dipakai, karena
pembaruan menimpa berkas itu.

**Pembaruan.** Pemasangan pertama selalu manual. Ini juga berlaku saat pindah format,
misalnya dari AppImage ke .deb. Setelah itu aplikasi mencari versi baru sendiri dan
menampilkan banner. Bisa juga dicek lewat Pengaturan → Aplikasi → "Periksa pembaruan".
Hanya admin yang dapat memasang pembaruan. Untuk .deb dan .rpm, Linux akan meminta kata
sandi akun komputer, bukan PIN kasir.

Data tidak hilang saat memperbarui atau pindah format. Semua format memakai folder data
yang sama (lihat bagian 5).

## 2. Printer thermal USB

1. Colok printer ke USB dan nyalakan.
2. Buka Pengaturan → Printer.
3. Di "Pilih Printer", pilih printer Anda. Belum muncul? Tekan tombol muat ulang di sebelahnya.
   Printer tanpa nama tampil sebagai "Printer USB" plus kodenya, misalnya `Printer USB 0416:5011`.
4. Atur Lebar Kertas, tekan Simpan, lalu Test Print.

Tidak perlu driver. Pemasangan dari .deb atau .rpm sudah memberi izin ke printer.

**Khusus AppImage.** Beri izin printer sekali saja dengan perintah ini:

```bash
echo 'SUBSYSTEM=="usbmisc", KERNEL=="lp[0-9]*", TAG+="uaccess"' \
  | sudo tee /etc/udev/rules.d/70-kasir-printer.rules
sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=usbmisc --action=change
```

Lalu cabut printer dan colok lagi.

Kalau daftar tetap kosong, jalankan `ls /dev/usb/`. Harus ada `lp0` atau sejenisnya. Kalau
tidak ada, coba kabel atau port USB lain.

## 3. Printer Bluetooth

1. Nyalakan printer dan dekatkan ke PC.
2. Pasangkan sekali lewat pengaturan Bluetooth sistem. Di Ubuntu dan Fedora: Settings →
   Bluetooth, lalu pilih printer. Jika diminta PIN, biasanya `0000` atau `1234` (cek buku
   panduan printer).
3. Di kasir: Pengaturan → Printer, tekan muat ulang. Printer muncul dengan akhiran
   "(Bluetooth)".
4. Pilih printernya, tekan Simpan, lalu Test Print.

Yang muncul hanya perangkat yang sudah dipasangkan dan bisa menerima cetakan. HP atau
headset tidak ikut muncul. Kalau printer tidak muncul, hapus pasangannya di Settings →
Bluetooth, lalu pasangkan lagi saat printer menyala.

## 4. Arti pesan kesalahan

Struk yang gagal bisa dicetak ulang dari Riwayat dengan tombol "Cetak Struk".

| Pesan | Artinya | Yang dilakukan |
| ----- | ------- | -------------- |
| "Kasir belum punya izin ke printer …" | Linux belum memberi akses ke printer USB. Biasanya karena memakai AppImage. | Jalankan perintah "Khusus AppImage" di bagian 2, atau pasang dari .deb/.rpm. Lalu cabut dan colok lagi printer. |
| "Printer USB tidak tersambung. Colok printer lalu coba lagi." | Printer yang dipilih tidak terdeteksi. | Cek kabel dan tombol daya. Kalau printer diganti, pilih ulang di Pengaturan → Printer. |
| "Printer tidak menerima data. Cek kertas dan tutup printer, lalu cetak ulang." | Printer menahan cetakan lebih dari 30 detik. Biasanya kertas habis atau tutup terbuka. | Isi kertas, tutup rapat, cetak ulang. |
| "Printer USB terputus saat mencetak." | Kabel lepas atau printer mati di tengah cetak. | Colok lagi, nyalakan, cetak ulang. |
| "Printer Bluetooth tidak menjawab. Pastikan printer menyala dan dekat." | PC tidak bisa menghubungi printer dalam 60 detik. | Nyalakan printer dan dekatkan. Pastikan Bluetooth PC aktif dan printer tidak sedang tersambung ke HP. |
| "Gagal menyambung ke printer Bluetooth: …" | Bluetooth PC menolak sambungan. | Matikan lalu nyalakan Bluetooth PC. Masih gagal: hapus pasangan, pasangkan lagi. |
| "Printer tidak ditemukan di daftar printer komputer ini. …" | Printer yang tersimpan tidak dikenal PC ini. | Pilih ulang printer di Pengaturan → Printer, lalu Simpan. |
| Nama printer dengan "(tidak terdeteksi)" | Printer tersimpan, tetapi sekarang tidak tersambung. | Colok atau nyalakan printer, lalu tekan muat ulang. |

Pesan lain yang diawali "Gagal membuka printer" atau "Gagal mengirim data ke printer"
dicatat di `error.log` (lihat bagian 5). Kirim berkas itu ke teknisi.

## 5. Data, log, dan backup

Semua data ada di `~/.local/share/com.kasir.pos/`. Folder ini tersembunyi; di pengelola
berkas, tekan Ctrl+H untuk menampilkannya.

| Isi        | Keterangan                                                     |
| ---------- | -------------------------------------------------------------- |
| `kasir.db` | database toko                                                  |
| `backups/` | backup otomatis dan hasil "Backup Sekarang"                    |
| `logs/`    | `startup.log`, `info.log`, `warning.log`, `error.log` (berikut `.1`, `.2` yang lebih lama) |

Menghapus aplikasi tidak menghapus folder ini.

**Backup.** Atur jadwalnya di Pengaturan → Data → Backup Otomatis. Untuk backup saat itu
juga, tekan "Backup Sekarang" di kartu Database.

Backup itu masih di PC yang sama. Kalau disk rusak, backup ikut hilang. Jadi salin rutin
ke flashdisk, misalnya seminggu sekali:

1. Pengaturan → Data → "Export Database". Berkas masuk ke folder unduhan.
2. Salin berkas itu ke flashdisk.

Jangan salin `kasir.db` langsung saat aplikasi terbuka; hasilnya bisa tidak lengkap.

**Pindah PC.** Export Database di PC lama. Pasang kasir di PC baru dan selesaikan pengisian
awal. Lalu Pengaturan → Data → "Import Database", pilih berkas tadi, dan buka ulang aplikasi.

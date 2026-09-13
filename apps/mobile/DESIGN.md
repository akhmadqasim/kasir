# DESIGN.md — Kasir Stok (mobile)

Adik dari [`DESIGN.md`](../../DESIGN.md) di akar repo. Yang di akar mengatur warna, angka,
dan bahasa; berkas ini hanya mengatur **apa yang berbeda antara iOS dan Android**, karena
di ponsel "terlihat sama di dua platform" berarti terasa asing di keduanya.

Aturan yang diwarisi tanpa perubahan: token warna HeroUI (tidak ada heks mentah, tidak ada
`bg-blue-500`), `tabular-nums` untuk setiap angka, teks UI di `packages/shared/src/i18n/id.ts`,
kalimat yang akan diucapkan orang.

## 0. Cara memilih

**Ikuti pedoman platformnya masing-masing, jangan saling menyerap.** iOS mengikuti Apple
HIG untuk iOS 26; Android mengikuti Material 3 apa adanya. Kalau sebuah keputusan diambil
"biar seragam dengan sisi sebelah", itu keputusan yang salah — dan kalau terpaksa
menyimpang, tulis alasannya di §5.

- **Beda struktural** (navigasi, tempat aksi utama, ada/tidaknya komponen) → cabang
  eksplisit lewat `isIOS` / `isAndroid` dari `src/lib/platform.ts`, atau berkas
  `*.web.tsx` kalau platformnya memang tidak didukung.
- **Beda kosmetik** (radius, ketebalan huruf, gaya kolom isian) → satu komponen bersama
  dengan token platform, jangan dua salinan.
- **Fitur iOS 26** (Liquid Glass, minimize-on-scroll) dipasang lewat prop yang memang
  diabaikan sistem di versi lama, jadi tidak ada `if (iosVersion >= 26)` tulisan tangan.

## 1. Matriks

| Pola                       | iOS 26 (HIG)                                                                                                                                                                           | Android (Material 3)                                                                                           | Implementasi                                                                                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tab bar**                | Tab bar Liquid Glass, warnanya diturunkan sistem dari isi layar, mengecil saat digulir ke bawah; ikon SF Symbol pasangan outline/fill                                                  | Navigation bar M3: pil indikator aktif, label selalu terlihat, ripple, Material Symbols                        | `NativeTabs` (`expo-router/unstable-native-tabs`). iOS: `sf={{ default, selected }}` + `minimizeBehavior="onScrollDown"`. Android: `src={<VectorIcon …>}`, `labelVisibilityMode="labeled"`, `indicatorColor`/`rippleColor`. Web: `_layout.web.tsx` |
| **Judul layar tab**        | Large title 34pt bold, rata kiri, ikut tergulir                                                                                                                                        | Top app bar M3 (small): judul 22pt, tinggi 64dp                                                                | `PageHeader`, digambar sebagai isi karena `NativeTabs` tidak memberi header. Ia **harus** berada di dalam scroll view — lihat §4                                                                                                                   |
| **Judul layar bertumpuk**  | Navigation bar dengan judul inline dan tombol kembali                                                                                                                                  | Top app bar M3 dengan judul dan panah kembali                                                                  | `Stack` native, `headerLargeTitle: false` untuk semua                                                                                                                                                                                              |
| **Aksi layar**             | Satu kontrol trailing saja — HIG memberi navigation bar judul, tombol kembali, dan satu kontrol. Lebih dari satu aksi masuk ke action sheet di balik ellipsis, dengan namanya tertulis | Sampai tiga ikon aksi di kanan top app bar, sesuai spesifikasi M3                                              | `components/header-actions.tsx` lewat `headerRight`. Bercabang di dalamnya. Angka tiga itu milik M3, bukan HIG — menyalinnya ke iOS persis jenis peminjaman yang dilarang §0                                                                       |
| **Aksi utama formulir**    | Item trailing di navigation bar (pola "Done")                                                                                                                                          | Tombol filled di akhir formulir — M3 **tidak** menaruh aksi formulir di top app bar                            | `components/form-submit.tsx`, bercabang di dalamnya                                                                                                                                                                                                |
| **Daftar panjang**         | Plain list: baris selebar layar, hairline menjorok ke awal teks, chevron di setiap baris yang menuju ke suatu tempat                                                                   | List item M3 di atas `surface`, pemisah selebar layar, tanpa chevron — ripple yang menandai baris bisa ditekan | `components/product-list.tsx` (`FlatList`) + `product-row.tsx`. Chevron dan inset pemisah bercabang `isIOS`                                                                                                                                        |
| **Grup pendek**            | Inset grouped: judul bagian kecil di luar grup, hairline antar baris                                                                                                                   | Baris M3 di atas `surface`, judul bagian beraksen, tanpa pemisah                                               | `components/section.tsx` — satu-satunya pemilik aturan pemisah. `variant`: `facts`, `fields`, `rows`                                                                                                                                               |
| **Sheet & dialog**         | Action sheet asli untuk konfirmasi merusak                                                                                                                                             | Dialog M3                                                                                                      | `Alert.alert` React Native memetakan ke keduanya                                                                                                                                                                                                   |
| **Kamera**                 | Presentasi layar penuh, tombol tutup di kiri atas (posisi Cancel)                                                                                                                      | Full-screen dialog M3, ikon tutup di awal bar                                                                  | `components/barcode-scanner-modal.tsx` — `Modal` RN `presentationStyle="fullScreen"`                                                                                                                                                               |
| **Garis pindai**           | Garis beraksen menyapu naik-turun selama kamera hidup                                                                                                                                  | sama                                                                                                           | `components/scan-frame.tsx` — `Animated` inti RN, `useNativeDriver`, berhenti saat kamera mati. Reduce Motion → garis diam                                                                                                                         |
| **Kolom isian**            | Kolom di dalam grup, latar `field`                                                                                                                                                     | Kolom M3 di atas latar halaman                                                                                 | `fieldVariant` di `platform.ts`: iOS `secondary`, Android `primary`                                                                                                                                                                                |
| **Pencarian**              | `SearchField` di atas daftar, ikut tergulir                                                                                                                                            | sama                                                                                                           | Satu komponen. Search bar di navigation bar tidak dipakai: tab memakai `NativeTabs`, yang tidak punya `Stack` per tab                                                                                                                              |
| **Keadaan kosong / gagal** | Kalimat pendek rata tengah; galat memakai `Alert status="danger"`                                                                                                                      | sama                                                                                                           | `state-view.tsx` — akar DESIGN.md §5.6 berlaku di dua platform                                                                                                                                                                                     |
| **Haptics**                | `notificationAsync` Success/Warning/Error                                                                                                                                              | `impactAsync` pendek untuk berhasil, Error untuk gagal — Android lebih hemat getaran                           | `src/lib/haptics.ts`                                                                                                                                                                                                                               |
| **Ikon**                   | SF Symbol lewat `expo-symbols`                                                                                                                                                         | MaterialCommunityIcons                                                                                         | `components/platform-icon.tsx`, dengan fallback glyph kalau modul simbol tidak ada                                                                                                                                                                 |
| **Mode gelap**             | Mengikuti sistem                                                                                                                                                                       | sama                                                                                                           | Token HeroUI + `ThemeProvider` react-navigation                                                                                                                                                                                                    |

## 2. Ikon tab

| Tab          | iOS (SF Symbol)                      | Android (MaterialCommunityIcons) |
| ------------ | ------------------------------------ | -------------------------------- |
| Scan         | `barcode.viewfinder`                 | `barcode-scan`                   |
| Produk       | `shippingbox` / `shippingbox.fill`   | `package-variant-closed`         |
| Stok Menipis | `exclamationmark.triangle` / `.fill` | `alert-circle-outline`           |
| Pengaturan   | `gearshape` / `gearshape.fill`       | `cog-outline`                    |

## 3. Yang butuh dev client, yang jalan di Expo Go

Semua yang ada di berkas ini jalan di **Expo Go SDK 57**: `NativeTabs`, `expo-symbols`,
`expo-haptics`, `expo-blur`, `expo-camera`, `expo-network`, `expo-secure-store`. Liquid
Glass bukan paket melainkan perilaku UIKit iOS 26; di iOS 18 tab bar-nya biasa dan
`minimizeBehavior` diabaikan. Yang belum bisa: mDNS (`react-native-zeroconf`).

## 4. Safe area — satu aturan, satu tempat

Layar tab tidak punya navigation header, jadi tidak ada yang memesan ruang status bar
untuknya. `useHeaderlessScrollProps()` (`components/screen.tsx`) mengurus keduanya: di iOS
lewat `contentInsetAdjustmentBehavior="automatic"` pada scroll view-nya (status bar di
atas, tab bar kaca di bawah), di Android lewat padding atas manual karena `NativeTabs`
hanya menerapkan inset bawah.

**Karena itu judul dan kolom cari harus berada di dalam scroll view**, bukan di atasnya.
Versi yang menaruh header di `View` biasa di luar daftar membuat judul menembus batas atas
layar — itu bug yang sudah terjadi sekali dan aturan ini yang mencegahnya berulang.

## 5. Penyimpangan yang disengaja

Tiga, dan hanya tiga:

1. **`@expo/ui` (SwiftUI `List`/`Form`) tidak dipakai.** Ia jalan di Expo Go, tetapi
   kontrak safe area `Host` + `List`-nya tidak bisa diverifikasi tanpa perangkat, dan
   percobaan pertamanya membuat tiga layar rusak. Daftar di iOS karena itu digambar React
   Native dengan gaya plain list — yang memang gaya iOS untuk daftar panjang yang bisa
   dicari; inset grouped tetap dipakai untuk grup pendek lewat `Section`.
2. **Overflow di iOS memakai action sheet, bukan pull-down menu.** iOS 26 lebih suka
   pull-down menu pada tombol ellipsis, tetapi React Native tidak punya UIMenu dan
   `@expo/ui` sudah dilepas (§5.1). `ActionSheetIOS` asli, selalu tersedia, dan menuliskan
   nama setiap aksi — yang untuk alat stok justru lebih terbaca daripada tiga glyph.
3. **Pemisah baris di Android.** M3 membolehkan daftar tanpa pemisah; di sini pemisah
   tetap digambar selebar layar karena barisnya dua baris teks dan tanpa garis daftarnya
   menyatu.

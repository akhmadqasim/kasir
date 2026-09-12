# DESIGN.md — Kasir Stok (mobile)

Adik dari [`DESIGN.md`](../../DESIGN.md) di akar repo. Yang di akar mengatur warna, angka,
dan bahasa; berkas ini hanya mengatur **apa yang berbeda antara iOS dan Android**, karena
di ponsel "terlihat sama di dua platform" berarti terasa asing di keduanya.

Aturan yang diwarisi tanpa perubahan: token warna HeroUI (tidak ada heks mentah, tidak ada
`bg-blue-500`), `tabular-nums` untuk setiap angka, teks UI di `packages/shared/src/i18n/id.ts`,
kalimat yang akan diucapkan orang.

## 0. Cara memilih

- **Beda struktural** (navigasi, tempat tombol utama, ada/tidaknya komponen) → cabang
  eksplisit lewat `isIOS` / `isAndroid` dari `src/lib/platform.ts`, atau berkas
  `*.web.tsx` kalau platformnya memang tidak didukung.
- **Beda kosmetik** (radius, ketebalan huruf, rata kiri/tengah, gaya kolom isian) → satu
  komponen bersama dengan token platform, jangan dua salinan.
- **Fitur iOS 26** (Liquid Glass, minimize-on-scroll) dipasang lewat prop yang memang
  diabaikan sistem di versi lama. Tidak ada `if (iosVersion >= 26)` yang ditulis tangan
  kecuali komponen itu benar-benar tidak ada di bawahnya.

## 1. Matriks

| Pola                       | iOS 26 (HIG / Liquid Glass)                                                                                                                  | Android (Material 3)                                                                  | Implementasi                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tab bar**                | Tab bar Liquid Glass, warnanya diturunkan sistem dari isi layar; mengecil saat digulir ke bawah; ikon SF Symbol dengan pasangan outline/fill | Navigation bar M3: pil indikator aktif, label selalu terlihat, ripple                 | `NativeTabs` (`expo-router/unstable-native-tabs`) di `(tabs)/_layout.tsx`. iOS: `sf={{ default, selected }}` + `minimizeBehavior="onScrollDown"`. Android: `src={<VectorIcon family={MaterialCommunityIcons} …>}`, `labelVisibilityMode="labeled"`, `indicatorColor`/`rippleColor` dari token. Web: `_layout.web.tsx` dengan `Tabs` JS |
| **Judul halaman**          | Large title 34pt bold, rata kiri, ikut tergulir                                                                                              | Top app bar M3 (small): judul 22pt di atas `background`, tinggi 64dp                  | `PageHeader` — satu komponen, dua token ukuran/berat. Layar dalam `Stack` memakai header asli; detail produk memakai `headerLargeTitle` di iOS                                                                                                                                                                                         |
| **Daftar & bagian**        | Inset grouped list: judul bagian kecil di luar grup, baris di kartu ber-radius, pemisah menjorok                                             | Baris M3 di atas `surface`, judul bagian berwarna aksen, sudut lebih kecil            | `Section` (`components/section.tsx`), satu-satunya pemilik aturan pemisah. `variant`-nya memilih isi: `facts` (baris label/nilai), `fields` (kolom isian, tanpa pemisah), `rows` (`ListGroup.Item`). Jangan susun grup sendiri dari `ListGroup` — di situlah pemisah gaya iOS pernah bocor ke Android                                  |
| **Aksi utama**             | Tombol lebar penuh di toolbar bawah berlatar kaca, di atas safe-area                                                                         | Extended FAB di kanan bawah untuk aksi utama; aksi lain jadi tombol teks/outline      | `components/action-bar.tsx`: satu berkas, satu daftar aksi, cabang `isIOS` di dalamnya — toolbar kaca vs bottom app bar M3 dengan extended FAB                                                                                                                                                                                         |
| **Aksi sekunder**          | `Button variant="tertiary"` berjajar di toolbar yang sama                                                                                    | `Button variant="outline"` / `ghost` di dalam kartu                                   | `ActionBar` menerima daftar aksi; urutannya identik di dua platform                                                                                                                                                                                                                                                                    |
| **Sheet & dialog**         | Konfirmasi merusak → action sheet asli (`Alert.alert` dengan `style: "destructive"`)                                                         | Dialog M3 (`Alert.alert` memetakan ke `AlertDialog`)                                  | `Alert.alert` React Native — sudah asli di dua platform, tidak perlu diganti                                                                                                                                                                                                                                                           |
| **Kolom isian**            | Kolom di dalam grup, latar `field`, label di atas, garis pemisah antar baris                                                                 | Kolom `outlined` M3 dengan label di atas garis                                        | `Input variant` dipilih `fieldVariant` di `platform.ts`: iOS `secondary` (menyatu di kartu), Android `primary`                                                                                                                                                                                                                         |
| **Papan angka**            | `keyboardType="number-pad"`, PIN `secureTextEntry`                                                                                           | sama                                                                                  | Sama di dua platform; alamat server memakai `url` (iOS) / `default` + `autoCapitalize="none"` (Android)                                                                                                                                                                                                                                |
| **Pencarian**              | `SearchField` HeroUI di atas daftar, tetap terlihat                                                                                          | sama, ditambah ripple bawaan                                                          | Satu komponen. Search bar asli di header sengaja **tidak** dipakai: ia hidup di `Stack`, sedangkan tab memakai `NativeTabs` tanpa `Stack` per tab                                                                                                                                                                                      |
| **Keadaan kosong / gagal** | Kalimat pendek rata tengah; galat memakai `Alert status="danger"`                                                                            | sama                                                                                  | `state-view.tsx`, tidak berbeda per platform — DESIGN.md §5.6                                                                                                                                                                                                                                                                          |
| **Progres pemindaian**     | Teks "Memeriksa 128/254" + bar tipis + subnet yang dipindai                                                                                  | sama, bar memakai `indicatorColor`                                                    | `ProgressBar` sederhana dari `View` + token `accent`                                                                                                                                                                                                                                                                                   |
| **Haptics**                | `notificationAsync(Success)` saat barang ketemu, `Error` saat tidak ketemu, `Warning` saat validasi gagal                                    | `impactAsync(Medium)` untuk ketemu, `Error` untuk gagal — Android lebih hemat getaran | `src/lib/haptics.ts`, satu fungsi per makna, bercabang di dalam                                                                                                                                                                                                                                                                        |
| **Kamera**                 | Tombol kaca di atas pratinjau, SF Symbol `camera.fill` saat menyala dan `camera` saat mati (SF Symbols 7 tidak punya `camera.slash`)         | Tombol ikon M3 di sudut pratinjau, `MaterialCommunityIcons`                           | `(tabs)/scan.tsx` + `scanner-store.ts`                                                                                                                                                                                                                                                                                                 |
| **Safe area**              | Scroll view minta insetnya sendiri (`contentInsetAdjustmentBehavior="automatic"`) — status bar di atas, tab bar kaca di bawah                | `NativeTabs` hanya memberi inset **bawah**; inset atas dipasang tangan                | `useHeaderlessScrollProps()` di `components/screen.tsx` — satu objek yang disebar `ScrollScreen` dan `FlatList` produk. `useSafeAreaInsets` langsung hanya untuk toolbar/FAB                                                                                                                                                           |
| **Mode gelap**             | Mengikuti sistem (`userInterfaceStyle: "automatic"`)                                                                                         | sama                                                                                  | Token HeroUI + `ThemeProvider` react-navigation supaya latar navigasi tidak berkedip putih                                                                                                                                                                                                                                             |

## 2. Ikon

Satu makna, dua keluarga ikon — jangan memakai keluarga yang sama di dua platform.

| Tab          | iOS (SF Symbol)                                              | Android (MaterialCommunityIcons) |
| ------------ | ------------------------------------------------------------ | -------------------------------- |
| Scan         | `barcode.viewfinder`                                         | `barcode-scan`                   |
| Produk       | `shippingbox` / `shippingbox.fill`                           | `package-variant-closed`         |
| Stok Menipis | `exclamationmark.triangle` / `exclamationmark.triangle.fill` | `alert-circle-outline`           |
| Pengaturan   | `gearshape` / `gearshape.fill`                               | `cog-outline`                    |

Di dalam layar, ikon memakai `@expo/vector-icons` (Ionicons di iOS, MaterialCommunityIcons
di Android) lewat `PlatformIcon`, bukan dipilih di tempat pemakaian.

## 3. Yang butuh dev client, yang jalan di Expo Go

Semua yang ada di berkas ini **jalan di Expo Go SDK 57**:

- `NativeTabs` ikut dalam Expo Go (dokumentasi Expo: "included in Expo Go"); ia memakai
  `react-native-screens`, yang memang sudah ada di sana.
- `expo-haptics`, `expo-blur`, `expo-camera`, `expo-network`, `expo-secure-store`: semuanya
  paket Expo Go.
- Liquid Glass bukan paket, melainkan perilaku UIKit di iOS 26. Di iOS 18 tab bar-nya
  tetap tab bar biasa dan `minimizeBehavior` diabaikan — tidak ada yang perlu dimatikan.
- Yang **belum** bisa: mDNS (`react-native-zeroconf`) — butuh dev client, karena itu
  penemuan server masih menyapu /24.

## 4. Batas yang dipatuhi

- Maksimal 5 tab di Android — aplikasi ini punya 4.
- `NativeTabs` tidak bisa disarangkan, tab tidak bisa ditambah/dihapus saat berjalan.
- `NativeTabs` tidak memberi header; judul layar tab digambar sebagai isi (`PageHeader`).
  Layar di luar tab tetap memakai header `Stack` asli, lengkap dengan tombol kembali.
- Peran (admin/kasir) tidak pernah menjadi urusan tampilan platform: aturannya sama di
  iOS dan Android, dan server tetap yang memutuskan.

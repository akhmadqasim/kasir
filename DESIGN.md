# DESIGN.md — Sistem Desain POS Toko Sembako

Dokumen ini mengatur bagaimana antarmuka aplikasi ini dibangun. Ia mengikat, bukan
sekadar saran: kalau kode dan dokumen ini berbeda, salah satunya bug.

Susunannya mengikuti bentuk yang dipakai hampir semua sistem desain yang dipublikasikan
— Shopify Polaris, IBM Carbon, Material, Adobe Spectrum — yaitu **Fondasi → Komponen →
Pola**, ditambah bagian bahasa, aksesibilitas, dan konvensi kode yang khusus milik repo
ini. Fondasi adalah hal yang tidak bisa dilihat sendirian (warna, jarak, tipografi);
komponen adalah benda yang bisa ditunjuk; pola adalah cara komponen disusun untuk
menyelesaikan satu pekerjaan.

---

## 1. Siapa yang memakai ini

Satu terminal di meja kasir toko sembako. Yang memakainya kasir dan pemilik toko, bukan
pekerja kantoran. Layarnya dilihat sambil berdiri, sering sambil memegang barang, dan
antrean di depan meja tidak menunggu. Itu yang membentuk seluruh keputusan di bawah.

Sejak migrasi ke mode web, layar yang sama juga dibuka dari ponsel atau tablet di jaringan
toko lewat nginx. Tata letak karena itu harus tetap terbaca dari 360 px sampai layar penuh.

## 2. Prinsip

**Angka dulu, keterangan belakangan.** Di kartu ringkasan dan kepala grafik, nilai
digambar besar di atas dan labelnya kecil di bawahnya. Mata datang ke baris itu untuk
angkanya.

**Jangan menampilkan tren yang tidak diukur.** Lencana panah hanya boleh muncul kalau
memang ada pembanding. `StatCard` menerima `delta: null` justru untuk ini — tiga dari
empat kartu ringkasan tidak punya angka kemarin, dan versi lama menempelkan panah naik
pada keempatnya. Angka karangan di layar uang lebih buruk daripada kolom kosong.

**Satu layar, satu pertanyaan.** Dashboard dipecah jadi tab karena "bagaimana hari ini",
"apa yang laku", dan "apa yang harus dibeli lagi" adalah tiga pertanyaan berbeda yang
tidak pernah ditanyakan bersamaan.

**Kontrol yang tidak berpengaruh lebih membingungkan daripada kontrol yang hilang.**
Pemilih rentang waktu hanya digambar di tab yang berisi deret waktu.

**Keyboard adalah alat utama, bukan pelengkap.** Kasir memakai pemindai barcode, yang di
mata browser adalah papan ketik yang mengetik sangat cepat lalu menekan Enter. ESC harus
menutup setiap dialog di mana pun.

## 3. Fondasi

### 3.1 Warna

Sumber kebenarannya `src/index.css`, memakai **palet resmi HeroUI v3**. Tidak ada warna
Tailwind mentah (`bg-blue-500`, `text-gray-400`) di mana pun dalam `src/`. Semua warna
dipanggil lewat nama tokennya.

| Token                                       | Dipakai untuk                                               |
| ------------------------------------------- | ----------------------------------------------------------- |
| `--background`                              | kanvas halaman dan sidebar                                  |
| `--surface`                                 | kartu dan panel di atas kanvas                              |
| `--surface-secondary`, `--surface-tertiary` | permukaan bertingkat di dalam kartu                         |
| `--overlay`                                 | dialog, popover, menu                                       |
| `--foreground`                              | teks utama                                                  |
| `--muted`                                   | teks sekunder, label, satuan                                |
| `--default`                                 | latar netral: hover, chip diam, wadah tab                   |
| `--accent`                                  | warna merek; aksi utama, garis grafik pertama, tab terpilih |
| `--success` / `--warning` / `--danger`      | naik / perlu perhatian / turun & rusak                      |
| `--border`, `--separator`                   | garis tepi dan garis pemisah                                |
| `--field-*`                                 | latar, teks, placeholder, dan tepi kolom isian              |

Seluruh netralnya bertint hue `253.83`, hue yang sama dengan aksennya. Itu yang membuat
permukaannya terasa sewarna dengan tombol birunya alih-alih abu-abu mati.

**Tidak ada lagi nama shadcn.** `--card`, `--popover`, `--primary`, `--secondary`,
`--muted-foreground`, `--destructive`, `--input`, `--ring`, dan seluruh `--sidebar-*` sudah
dihapus bersama paket `shadcn` itu sendiri. Yang tersisa di luar palet HeroUI hanya token
kategori — `--chart-1..5` dan `--service-*` — dan keduanya dijelaskan di 3.2.

Nilai yang ditulis di `index.css` hanya yang memang dipilih berbeda dari bawaan HeroUI:
hue netralnya dan `--radius`. Selebihnya — skala radius, `--spacing`, seluruh warna
`*-hover` dan `*-soft`, bayangan, lebar cincin fokus — dihitung HeroUI sendiri dari
nilai-nilai itu. Jangan menuliskannya ulang; menyalin satu nilai turunan ke `index.css`
memutus hubungannya dengan induknya tanpa ada yang menyadari.

Mode gelap adalah kelas `dark` atau `data-theme="dark"` di `<html>`.

### 3.2 Warna kategori

Dua kelompok warna berdiri di luar palet makna, dan keduanya ada karena warnanya benar-benar
membawa informasi: `--chart-1..5` untuk seri grafik, dan `--service-*` untuk sembilan
layanan PPOB. Kasir mengenali "Listrik" dari warnanya sebelum sempat membaca labelnya.

Keduanya ditulis pada pita lightness yang sama, 60–75%, sehingga satu nilai terbaca di atas
`--background` terang maupun gelap. **Tidak ada `dark:` di komponen mana pun untuk warna
kategori** — varian gelap yang ditulis tangan per warna adalah persis yang baru saja
dibuang, dan pasangan seperti `bg-blue-100 dark:bg-blue-950` selalu berakhir dengan satu
sisi yang lupa diperbarui.

Latar redupnya diturunkan dengan penanda opasitas Tailwind, bukan warna kedua:
`bg-[var(--service-pulsa)]/15`. Itu cara HeroUI membuat varian `-soft`-nya sendiri.

Warna Tailwind mentah (`bg-blue-500`, `text-gray-400`) tidak boleh muncul di `src/`.

### 3.3 Warna grafik

`--chart-1..5` **bukan gradasi satu warna.** Grafik metode pembayaran menggambar sampai
lima garis sekaligus dan lima tingkat biru yang berdekatan tidak terbedakan begitu
garisnya bersinggungan. Seri pertama memakai aksen; sisanya memutari roda warna pada
lightness yang setara sehingga tidak ada satu garis pun yang tampak lebih penting.

Pemetaan warna ke metode pembayaran **dipatok**, bukan dibagi menurut urutan kemunculan
(`METHOD_COLORS` di `src/lib/labels.ts`, bersebelahan dengan labelnya, dibaca dashboard
dan laporan). Kalau dibagi berurutan, satu hari
tanpa QRIS akan menggeser seluruh warna dan kasir yang hafal "garis biru itu tunai"
membaca grafik yang salah.

### 3.4 Tipografi

Satu keluarga huruf: **Geist Variable**, dimuat lokal lewat `@fontsource-variable/geist`.
Bukan Inter seperti contoh di dokumentasi HeroUI — aplikasi ini harus jalan tanpa internet,
jadi huruf yang diambil dari CDN tidak boleh dipakai.

Hanya empat peran yang boleh menimpa ukuran huruf bawaan komponen. Sisanya memakai apa yang
sudah diberikan HeroUI.

Angkanya dibaca dari computed style template dashboard HeroUI Pro, bukan dipilih — kecuali
baris terakhir, yang tidak punya padanan di template dan alasannya ditulis di bawah.

| Peran                           | Kelas                                                |
| ------------------------------- | ---------------------------------------------------- |
| Judul halaman (di navbar)       | `text-xl font-semibold`                              |
| Angka KPI                       | `text-2xl font-semibold tracking-tight tabular-nums` |
| Angka sekunder di kepala grafik | `text-xl font-semibold tracking-tight tabular-nums`  |
| Total keranjang (kasir)         | `text-3xl font-semibold tracking-tight tabular-nums` |

Total keranjang satu tingkat di atas angka KPI karena dibaca dari jarak — kasir berdiri,
pelanggan di seberang meja — dan satu ukuran tanpa breakpoint: angka yang mengecil di layar
sempit adalah angka yang salah dibaca.

`Card.Title` (`text-sm font-medium`) dan `Card.Description` (`text-sm text-muted`) dipakai
apa adanya — jangan diberi `text-base` atau `font-semibold`. Hierarki halaman ini datang
dari angkanya yang besar, bukan dari judul kartunya yang dibesar-besarkan.

**Setiap angka memakai `tabular-nums`.** Tanpa itu digit berbeda lebar, dan kolom nominal
yang rata kanan bergoyang saat datanya berubah.

### 3.5 Jarak dan sudut

Kelipatan 4 px milik Tailwind. Yang dipakai berulang: `gap-2` di dalam satu baris kontrol,
`gap-4` antar kartu, `gap-6` antar bagian besar halaman.

**Jangan atur padding kartu.** `Card` HeroUI sudah `p-4` dengan `gap-3` antar
`Card.Header` / `Card.Content` / `Card.Footer`. Susun isinya lewat ketiga bagian itu, bukan
lewat `p-5` dan rentetan `mt-*` di dalam satu `div` — itu melawan komponennya, dan
jaraknya berhenti konsisten begitu ada satu kartu yang lupa disamakan.

`--radius` **tidak ditetapkan** — bawaan HeroUI, `0.5rem`. Seluruh skala diturunkan dari
angka itu (`--radius-3xl = radius × 3`), dan `Card` memakai `min(32px, --radius-3xl)`.
Tema yang pernah disalin ke sini memasang `0.75rem`, yang membuat sudut kartu 32px dan
baris menu 24px; template dashboard HeroUI memakai bawaannya, 24px dan 16px, dan selisih
itulah yang membuat tampilannya terasa asing meski paletnya sama. Kartu lalu ditimpa lagi
ke `--radius-2xl` (16px) lewat `@layer components { .card }`, karena template melakukan
itu pada setiap kartunya.

**Sudut `Surface` juga `--radius-2xl`, dari aturan global yang sama** (`.surface` di
`index.css`). Bawaan HeroUI tidak memberi `Surface` sudut sama sekali, dan 22 pemakaiannya
sempat menulis radiusnya sendiri — 15 `rounded-2xl`, 6 `rounded-xl` — bukan karena sengaja
berbeda, melainkan karena ditulis orang yang berbeda. Jangan tulis `rounded-*` pada
`Surface` maupun `Card`; kalau satu tempat memang harus berbeda, tulis kelasnya dengan
komentar yang menyebut alasannya.

**Panel setinggi layar memakai `border`, kartu memakai `shadow-surface`.** Keranjang kasir,
katalog, dan panel refund adalah `Surface` yang mengisi tinggi layar dan bertemu tepi
viewport; bayangan di tepi yang terpotong hanya terlihat sebagai garis kotor, jadi panel
itu diberi `border` dan tidak berbayang. `Card` yang berdiri di kanvas dengan ruang di
sekelilingnya tetap memakai `shadow-surface` bawaannya. Keputusan, bukan kebetulan —
jangan menyamakan keduanya ke salah satu arah.

Halaman **tidak menambahkan padding luarnya sendiri**. `app-layout` memberi `px-6` supaya
tepi isi sejajar dengan tepi judul di navbar; halaman hanya mengatur `gap` antar bagian.
Isi dashboard dipusatkan `max-w-7xl`; layar kasir penuh, karena keranjang dan katalog
butuh lebarnya.

### 3.6 Ikon

`lucide-react` saja. Ukurannya diwarisi dari komponen HeroUI; hanya beri `className="size-*"`
kalau ikonnya berdiri di luar tombol atau chip.

Satu pengecualian yang disengaja: logo toko bawaan adalah `LogoRustore` dari
`@gravity-ui/icons` (set ikon yang dipakai dokumentasi HeroUI sendiri), digambar oleh
`src/components/store-logo.tsx` sebagai `Avatar.Fallback` di sidebar dan di pratinjau
pengaturan. Ia tampil hanya sampai pemilik toko mengunggah logonya sendiri di Pengaturan →
Toko. Jangan mengimpor ikon lain dari paket itu.

## 4. Komponen

**HeroUI v3 untuk semua komponen dasar.** Satu-satunya pengecualian adalah
`src/components/ui/chart.tsx`, pembungkus recharts warisan shadcn, dan itu ada karena
HeroUI memang tidak punya grafik. Jangan menambah pengecualian kedua; kalau HeroUI tidak
punya sesuatu, bangun dari primitifnya.

Jangan tulis ulang komponen yang sudah ada. Sebelum membuat yang baru, periksa daftar
komponen HeroUI — kalau MCP server-nya aktif (`.mcp.json`), `list_components` dan
`get_component_docs` menjawab lebih cepat daripada menebak.

**Kolom isian di atas permukaan memakai `variant="secondary"`.** `TextField`, `Select`,
`ComboBox`, `NumberField`, dan `PinInput` yang berdiri di dalam `Card`, `Surface`, atau
`Modal` — yang latarnya sudah `bg-surface` — memakai varian itu supaya kolomnya tidak
menyatu dengan latar induknya; itu contoh "In Surface" di dokumentasi TextField. Kolom yang
langsung di atas kanvas halaman (bar pencarian, filter) memakai varian bawaan. Aturan ini
berlaku sekali di sini; jangan tulis ulang alasannya sebagai komentar di tiap berkas.

### 4.1 Varian mengikuti makna, bukan rupa

Ini prinsip nomor satu HeroUI v3: nama varian menyatakan **peran** sebuah aksi, bukan
gambarannya. Pilih varian dari pertanyaan "seberapa penting aksi ini", bukan "saya ingin
tombolnya bergaris atau terisi".

| `Button`                 | Untuk                               | Banyaknya            |
| ------------------------ | ----------------------------------- | -------------------- |
| `primary` (bawaan)       | aksi utama yang memajukan pekerjaan | **satu per konteks** |
| `secondary`              | aksi alternatif                     | boleh beberapa       |
| `tertiary`               | aksi ringan atau membatalkan        | secukupnya           |
| `danger` / `danger-soft` | aksi merusak                        | saat perlu           |

`outline` dan `ghost` masih ada di pustakanya, tapi keduanya nama rupa dan bukan nama
peran. **Jangan dipakai, di mana pun.** Keduanya sempat terpakai 112 kali di seluruh
aplikasi — bukan sebagai pilihan, melainkan sebagai kebiasaan yang terbawa dari shadcn —
dan sudah disapu habis.

Dua aturan turunan yang paling sering dilanggar:

**Satu `primary` per layar.** Kalau dua tombol sama-sama terasa pantas jadi primary, salah
satunya bukan. Tanyakan mana yang benar-benar memajukan pekerjaan; sisanya `secondary`.
Karena `primary` adalah nilai bawaan `Button`, tombol itu ditulis tanpa prop varian sama
sekali — `<Button>Simpan</Button>`.

**Tombol merusak memakai `variant="danger"`, bukan `text-danger`.** Mewarnai teksnya merah
sendiri adalah cara lama menirukan varian yang sudah ada. Hasilnya bukan cuma beda tipis:
`danger` mengatur latar, teks, hover, dan cincin fokus sekaligus, sedangkan tambalan
manual hanya mewarnai satu di antaranya dan menyisakan tiga sisanya netral.

- `Chip` — warna `default` (bawaan), `accent`, `success`, `warning`, `danger`; varian
  `primary`, `secondary` (bawaan), `tertiary`, `soft`. Kombinasi `soft` + warna semantik
  punya gaya bawaan; `soft` + `default` tidak, jadi lencana netral memakai varian bawaan.
- `Tabs` — `primary` (bawaan) atau `secondary`. Wadahnya sudah `bg-default` dan membulat,
  jadi bentuk segmented seperti di contoh HeroUI didapat tanpa satu kelas tambahan pun.

Teks polos di dalam `Chip` **otomatis** dibungkus `Chip.Label` — tulis `<Chip>Tunai</Chip>`.
`Chip.Label` hanya perlu ditulis sendiri kalau ada ikon di sebelahnya.

- `Switch` mengikuti contoh "With Description": `Switch.Control` dulu, lalu teks labelnya,
  `Description` di bawah. Bukan label di kiri dan sakelar di kanan dengan `w-full
justify-between` — itu bentuk layar pengaturan ponsel, bukan bentuk HeroUI.
- Tombol yang menempel pada kolom isian (generate, salin, lihat sandi) masuk ke
  `InputGroup.Suffix className="pe-0"` sebagai `Button isIconOnly size="sm" variant="tertiary"`,
  contoh "Copy Button Suffix" di dokumentasi InputGroup — bukan `flex items-end gap-2` yang
  menyejajarkan tombol ke dasar kolom dengan tangan, dan patah begitu kolomnya punya
  `Description`.
- `Avatar` bulat, bawaannya. Tidak ada `rounded-lg` pada `Avatar` atau `Avatar.Fallback`;
  itu bentuk avatar shadcn.
- Pintasan keyboard ditulis sebagai `Kbd variant="light"` di dalam tombol yang memicunya,
  setelah label; tidak ada legenda pintasan terpisah. Di tombol `primary` beri
  `className="text-accent-foreground"` karena `.kbd` memaksa `text-muted`.
  `aria-keyshortcuts` tidak bisa dipakai — React Aria membuangnya dari `Button`.

### 4.2 Komponen bersama

Pola yang muncul di lebih dari satu fitur ditulis sekali di `src/components/`. Sebelum
menulis kartu angka, baris label–nilai, keadaan kosong, tombol yang menunggu, kotak info,
atau kepala sub-halaman, pakai yang di bawah ini — masing-masing pernah punya 3–6
implementasi karena migrasi HeroUI dikerjakan per fitur.

| Berkas di `src/components/`                              | Tugas                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stat-card.tsx` — `StatCard`                             | satu kartu KPI; `delta` untuk tren, `note` lencana netral, `tone` warna angka (`success`/`danger`), `action` kontrol di kanan kepala, `children` baris di bawah angka, `footer` isi `Card.Footer`; `value` boleh `ReactNode` supaya kartu yang memuat menaruh `Skeleton` di baris angka |
| `summary-list.tsx` — `SummaryList`, `SummaryItem`        | baris label–nilai semantik `<dl>`; `tone` per baris (`mono`/`strong`/`success`/`danger`), `layout` `row` (nilai rata kanan) atau `grid` (kolom label 120px)                                                                                                                             |
| `no-data.tsx` — `NoData`                                 | keadaan kosong dan gagal di atas `EmptyState` HeroUI (yang dipakai dokumentasi Table/ComboBox untuk `renderEmptyState`); ikon `size-6` lalu satu kalimat, `tone="danger"` untuk pesan gagal                                                                                             |
| `search-input.tsx` — `SearchInput`                       | bar pencarian di atas tabel: `SearchField` > `Group` > ikon + kolom + tombol hapus, ditulis sekali; `aria-label` wajib, varian bawaan karena berdiri di kanvas                                                                                                                          |
| `option-select.tsx` — `OptionSelect`                     | `Select` untuk daftar `{ key, label }` statis (status, alasan, peran, satuan); `label` atau `aria-label`, `description`, `errorMessage`; `onChange` menerima `string \| null`                                                                                                           |
| `pending-button.tsx` — `PendingButton`                   | `Button` HeroUI plus `isPending`; spinner di kiri label, label tidak berubah                                                                                                                                                                                                            |
| `info-panel.tsx` — `InfoPanel`                           | kotak info di dialog: `Surface variant="secondary"`, `p-3 text-sm`, sudut dari aturan global                                                                                                                                                                                            |
| `status-badge.tsx` — `StatusBadge`                       | lencana status semantik (`success`/`error`/`warning`/`info`/`neutral`) di atas `Chip`; satu-satunya tempat makna status dipetakan ke warna                                                                                                                                              |
| `table-pagination.tsx` — `TablePagination`               | baris halaman di bawah tabel, `Pagination` HeroUI ukuran `sm` rata kanan                                                                                                                                                                                                                |
| `date-range-picker.tsx` — `DateRangePicker`              | pemilih rentang tanggal laporan dan riwayat, dua bulan berdampingan                                                                                                                                                                                                                     |
| `product-autocomplete.tsx` — `ProductAutocomplete`       | pencarian produk di dialog (refund, tukar, write-off): `Autocomplete` dengan `SearchField` di popover                                                                                                                                                                                   |
| `auth-card.tsx` — `AuthCard`, `AuthScreen`               | kartu dan kanvas layar login/onboarding, mengikuti `login-demo` HeroUI                                                                                                                                                                                                                  |
| `layout/app-navbar.tsx` — `NavbarTitle`, `NavbarActions` | portal judul dan aksi halaman ke slot navbar milik `AppLayout`                                                                                                                                                                                                                          |
| `layout/subpage-header.tsx` — `SubpageHeader`            | judul + tombol kembali (+ aksi) sub-halaman, semuanya di navbar                                                                                                                                                                                                                         |

Yang masih tinggal di `features/dashboard/components/` karena memang hanya dashboard yang
memakainya: `inline-stat.tsx` (angka sekunder di kepala kartu grafik), `section-card.tsx`
(pembungkus daftar: judul lalu isi — keadaan kosongnya `NoData` dari `src/components/`,
bukan miliknya sendiri), `time-range.ts` / `time-range-menu.tsx` (pilihan rentang waktu).

## 5. Pola

### 5.1 Susunan halaman

```
Navbar (64px)    — tombol lipat sidebar, judul halaman, aksi di kanan; milik AppLayout
Baris kendali    — tab di kiri; muat-ulang dan pemilih periode (ukuran sm) di kanan
Isi              — kartu, grafik, tabel
```

Navbar dimiliki `AppLayout`, bukan halaman. Judulnya diturunkan dari rute lewat
`app/navigation.tsx`, sumber yang sama dengan menu sidebar, jadi judul di atas halaman
tidak bisa berbeda dari label yang membukanya. Halaman yang mau judul lain memasangnya
lewat `NavbarTitle`, dan aksinya lewat `NavbarActions` — keduanya portal ke slot di
navbar, dan CSS `:empty` pada slot judul yang menyembunyikan judul bawaan. Tidak ada state
yang menyinkronkan keduanya. Test yang merender satu halaman memakai `TestNavbar` dari
`test-utils`; kode produksi tidak punya cabang "kalau tidak ada navbar".

Aksi cepat naik ke navbar sebagai tombol ikon `sm tertiary`, bukan turun sebagai kartu
berisi tombol-tombol besar. Tujuannya sudah ada di sidebar; yang benar-benar ditekan tiap
pagi hanya satu, dan itu yang tetap berupa tombol bertulisan.

Tombol lipat sidebar duduk di navbar, bukan di kepala sidebar: kontrol yang mengubah tata
letak halaman tinggal di halaman, dan di ponsel tombol yang sama membuka drawer.

Tombol muat-ulang di navbar (dan di kepala kartu) adalah `Button isIconOnly isPending` dengan
render-prop `Spinner color="current"`; `PendingButton` menaruh spinner di samping label, dan
tombol ikon tidak punya label. Bukan `RefreshCw className="animate-spin"` — itu ikon yang
menirukan `Spinner`.

**Sub-halaman memakai `SubpageHeader`** (`src/components/layout/subpage-header.tsx`):
judul dan tombol kembali `sm tertiary` keduanya di navbar, aksinya lewat prop `actions`.
Pengaturan Mitra, mutasi, notifikasi, buat refund, dan tutup kasir pernah menulis "tombol
kembali + judul" dengan tiga cara berbeda; sekarang satu. **Tidak ada `<h1>` di badan
halaman** selain pada dokumen cetak — judul halaman sudah ada di navbar, dan `<h1>` kedua
membuat pembaca layar mengumumkan judul yang sama dua kali.

### 5.2 Tab

Pakai tab ketika satu layar menjawab beberapa pertanyaan yang tidak ditanyakan bersamaan.
Jangan pakai tab untuk memecah satu pekerjaan menjadi langkah — itu wizard.

Panel yang tidak terpilih tidak dirender oleh React Aria. Ini menguntungkan (tidak ada
permintaan jaringan untuk panel yang tidak dilihat) tapi harus diingat saat menulis test:
isinya baru ada setelah tabnya diklik.

`Tabs.Panel` bawaan sudah `p-2` dan `mt-4` dari daftar tabnya; jangan tulis `pt-*`/`p-*`
di panel.

### 5.3 Kartu KPI

Tiga hal saja: label, lencana bila ada yang dibandingkan, angka. **Tidak ada baris
keterangan yang mengulang labelnya.** "Transaksi selesai" di bawah kartu berjudul
"Transaksi Hari Ini" hanya mengatakan judulnya dengan kata lain, dan empat kartu
berdampingan yang masing-masing punya empat baris membuat baris teratas dashboard terasa
penuh sebelum satu angka pun terbaca.

`children` dan `footer` pada `StatCard` ada untuk fakta yang tidak dibawa label maupun
angkanya — catatan "termasuk 3 topup tanpa tanggal" di mutasi PPOB, bilah porsi di kartu
metode pembayaran. Kalau kalimatnya bisa dihapus tanpa ada informasi yang hilang, jangan
diisi.

Empat kartu per baris di layar lebar, dua di tablet, satu di ponsel. Tanpa gradasi, tanpa
bayangan tambahan, tanpa paragraf di kaki kartu.

### 5.4 Tabel

Selalu `Table` HeroUI di dalam `Table.ScrollContainer`, dengan `aria-label` pada
`Table.Content` — label itulah yang dipakai test untuk menemukan tabelnya, jadi jangan
diubah tanpa alasan. Kolom nominal rata kanan dan `tabular-nums`; kolom teks boleh
`truncate` dengan `max-w-*`.

Keadaan kosong lewat `renderEmptyState={() => <NoData />}`, bukan satu baris ber-`colSpan`.

Baris tabel di dalam dialog (rincian transaksi, item refund) memakai `Table
variant="secondary"` yang sama, bukan `Surface divide-y`.

**Sel berisi teks tetap teks.** Metode pembayaran di tabel transaksi pernah dibungkus
`Chip`; sepuluh baris berarti sepuluh lencana, dan lencana berhenti berarti apa-apa ketika
setiap baris punya satu. Lencana disimpan untuk yang benar-benar status — `StatusBadge`
pada transaksi yang belum tuntas dan pada stok yang habis. Lencana kategori (jenis,
alasan, tipe, peran) yang muncul di setiap baris ditulis sebagai teks; hanya kolom status
memakai `StatusBadge`.

**Aksi baris mengikuti contoh "Custom Cells" di dokumentasi Table:** `Button isIconOnly
size="sm"` berjajar dalam `flex items-center justify-end gap-1`, `variant="tertiary"`
untuk aksi biasa (ubah, pin, setujui) dan `variant="danger-soft"` untuk yang merusak
(hapus, nonaktifkan, tolak, pulihkan). `aria-label` menyebut aksinya dan nama barisnya —
"Hapus Indomie Goreng" — karena itulah yang dibaca pembaca layar dan test. Tidak ada
`primary` di baris tabel: satu per baris berarti sepuluh per layar. Aksi baris selalu
terlihat, bukan muncul saat hover — layar ini juga dibuka dari tablet.

**Daftar pilih-satu** (merchant, bank, kotak masuk) memakai `ListBox selectionMode="none"
onAction` di dalam `Surface`, seperti contoh "With Sections" — bukan kolom
`Button variant="secondary"`.

**Baris memuat = baris `Skeleton`**: selama permintaan pertama, `Table.Body` diisi
beberapa `Table.Row` berisi `Skeleton className="h-5 w-full"` per sel, bukan `NoData
title="Memuat..."` dan bukan tabel yang hilang lalu muncul.

### 5.5 Grafik

Batang untuk nilai per hari kalender; garis untuk sesuatu yang benar-benar mengalir antar
titik. Sumbu-x hari kalender **tidak** digambar sebagai garis: garis di antara dua hari
menyiratkan nilai antara yang tidak pernah ada.

Setiap grafik punya keadaan kosong setinggi grafiknya sendiri, supaya tata letak tidak
melompat saat data datang.

### 5.6 Keadaan memuat, kosong, dan gagal

Kosong: `NoData` (`src/components/no-data.tsx`) — tanpa prop ia kalimat pendek dari
`t.dashboard.noData`, rata tengah; beri `icon` dan `title` untuk kolom ringkasan yang
belum terisi. Ia dibangun di atas `EmptyState` HeroUI; daftar di dalam popover
(`ComboBox`, `Autocomplete`) memakai `EmptyState` langsung dengan kalimatnya, seperti di
dokumentasinya — bukan `<p className="px-3 py-6 text-center …">`. Gagal: `NoData
tone="danger"` dengan pesan dari `ApiError`, jangan pernah menampilkan pesan mentah dari
`Database`/`Internal` — keduanya sudah diredaksi di sisi server dan yang asli hanya masuk
log.

Memuat di dalam tombol: `PendingButton` (`src/components/pending-button.tsx`) dengan
`isPending` dari mutasinya. Spinner muncul di kiri label, labelnya tetap. **Tidak ada
`Loader2 animate-spin`** — itu ikon shadcn yang menirukan `Spinner` HeroUI — dan **tidak
ada label yang berganti jadi "Menyimpan..."/"Memproses..."**: lebar tombol berubah saat
ditekan dan barisan tombol di footer ikut bergeser, sementara `isPending` React Aria sudah
memberi tahu pembaca layar bahwa tombolnya sibuk.

### 5.7 Dialog

Acuannya contoh **Default** di dokumentasi Modal HeroUI, tidak lebih:

```
Modal.CloseTrigger
Modal.Header
  Modal.Icon  (bg-default text-foreground, ikon size-5)   — opsional
  Modal.Heading                                           — bawaan text-base font-medium
Modal.Body                                                — bawaan text-sm text-muted
  satu kalimat, bila memang perlu
  kolom isian (TextField variant="secondary")
Modal.Footer
  Button tertiary slot="close"  +  Button (primary)       — atau satu tombol fullWidth
```

Aturannya:

**Satu keterangan per dialog.** Kalimat penjelas ada di Body sebagai `<p>` polos —
bukan `<p className="text-sm leading-5 text-muted">` di Header, karena Body bawaannya
sudah `text-sm text-muted` dan menulis ulang ketiganya di Header hanya menyalin gaya yang
sudah ada ke tempat yang salah. Kalau kalimat itu sudah ada, kolom isiannya tidak perlu
`Description` lagi — "Buka Kasir" pernah mengatakan hal yang sama empat kali: ikon,
subjudul, label, dan keterangan kolom.

**Jarak antar isi Body datang dari aturan global.** `.modal__body` dan
`.alert-dialog__body` sudah `flex flex-col gap-4` lewat `@layer components` di
`index.css`; jangan tulis `flex flex-col gap-*` atau `space-y-*` pada `Modal.Body` lagi.
Tiga belas dialog pernah menulis `gap-4`, dua `gap-3`, tiga `space-y-*` — untuk jarak
yang seharusnya sama.

**Kotak info di dialog = `InfoPanel`** (`src/components/info-panel.tsx`): ringkasan
barang yang akan diubah, saldo yang akan dipakai. `Surface variant="secondary"` dengan
`p-3 text-sm`, sudut dari aturan global. Bukan `Alert` — itu untuk pesan berstatus.

**`border-dashed` tidak dipakai**, kecuali pada drop-zone berkas sungguhan
(`import-dialog`). Garis putus-putus menyiratkan area yang bisa dijatuhi sesuatu; pada
kotak ringkasan atau keadaan kosong ia menjanjikan interaksi yang tidak ada.

**Tidak ada garis.** `border-b` di Header dan `border-t` di Footer adalah pemisah shadcn;
HeroUI memisahkan bagian dengan ruang (`.modal__header + .modal__body { mt-2 }`,
`+ .modal__footer { mt-5 }`), dan itu sudah otomatis.

**Lebar lewat `Modal.Container size`**, bukan `sm:max-w-*` di Dialog. `scroll="inside"`
(bawaan) sudah membatasi tinggi dan menggulung Body. Lebar khusus di luar skala boleh
ditulis di `Modal.Dialog className` dengan komentar, karena dokumentasinya sendiri
melakukan itu.

**Ikon bertumpuk di atas judul** lewat `Modal.Icon`, bukan disisipkan ke `Modal.Heading`
dengan `flex items-center gap-2`. Latar `bg-default text-foreground` untuk ikon netral,
`bg-*-soft text-*-soft-foreground` bila ikonnya menyatakan status.

**Kolom isian di dalam dialog memakai `variant="secondary"`** (aturan umum §4) dan tidak menimpa tinggi,
ukuran huruf, atau bobot bawaan (`h-12`, `text-lg`, `font-bold`, label uppercase). Yang
tersisa hanya perataan angka: `text-right tabular-nums`.

**Kolom isian di dialog selalu punya `<Label>` terlihat.** `aria-label` saja hanya untuk
kolom yang labelnya sudah berdiri di sebelahnya sebagai teks — nama metode di dialog
pembayaran, nama kolom di pemetaan import. Placeholder bukan label: ia hilang begitu
kolomnya diisi, dan tidak boleh mengulang labelnya.

**Tombol yang hanya menutup dialog baca-saja bertuliskan "Tutup"** (`common.close`),
bukan "Batal" — tidak ada yang dibatalkan.

**Konfirmasi yang merusak memakai `AlertDialog`** dengan `AlertDialog.Icon status=…`,
tanpa CloseTrigger — keputusannya harus eksplisit.

**Tombol yang hanya menutup memakai `slot="close"`.** Tombol yang juga mereset state di
luar dialog tetap `onPress`; jangan pindahkan reset itu ke `onOpenChange` diam-diam.

**Jangan memaksa lewat banner.** Kalau sebuah dialog sudah terbuka otomatis untuk sebuah
keadaan (shift belum dibuka), jangan tambahkan `Alert` di halaman yang mengatakan hal yang
sama. Jalan masuk kembali ke dialog itu adalah satu tombol di navbar.

## 6. Bahasa dan format

**Antarmuka bahasa Indonesia, kode bahasa Inggris.** Label UI hidup di `src/i18n/id.ts`;
jangan tulis teks Indonesia langsung di komponen kecuali untuk `aria-label` yang memang
sekali pakai.

- Uang: `formatRupiah` — `Rp 150.000`, tanpa desimal. Label sumbu grafik memakai
  `formatCompactRupiah` (`150 rb`) tanpa awalan "Rp", karena label sumbu diulang belasan
  kali dan awalannya hanya menghabiskan lebar.
- Bilangan: `formatNumber` — pemisah ribuan gaya Indonesia.
- Waktu: disimpan UTC, ditampilkan waktu lokal lewat `formatDateTime` / `formatDayDate`.
- Sapaan waktu memakai pembagian Indonesia (pagi < 11, siang < 15, sore < 19, malam),
  bukan terjemahan morning/afternoon/evening yang batasnya berbeda.

Tulis kalimat yang akan diucapkan orang. "Belum ada data", bukan "Data tidak tersedia".

## 7. Aksesibilitas

Ini bukan bagian tambahan: aplikasinya dijalankan dengan pemindai barcode dan papan ketik,
jadi semantik yang benar adalah syarat agar alatnya bekerja.

- Setiap kontrol tanpa teks terlihat wajib punya `aria-label` berbahasa Indonesia.
- `Table.Content`, `Tabs.List`, dan legenda grafik semuanya diberi `aria-label`.
- Elemen dekoratif (titik warna legenda, pemisah `·`) diberi `aria-hidden="true"`.
- ESC menutup setiap overlay. HeroUI mematikannya secara bawaan di sebagian overlay;
  kalau itu terjadi, hidupkan kembali.
- Jangan pernah memakai warna sebagai satu-satunya pembeda. Stok habis memakai warna
  _dan_ angkanya; garis grafik memakai warna _dan_ legenda bertulisan.

## 8. Struktur berkas

HeroUI tidak menetapkan struktur folder apa pun — yang ada di dokumentasinya hanya
template CLI (Vite, Next.js, React Router). Jadi aturan di bawah ini milik repo ini
sendiri, melanjutkan susunan yang sudah dipakai seluruh fitur lain.

```
src/features/<fitur>/
├── components/      satu komponen per berkas, kebab-case
│   └── <fitur>-page.tsx    kerangka halaman: header, kendali, panel
├── hooks/           pembungkus TanStack Query dan store Zustand
├── types.ts         bentuk data yang dikirim backend
├── index.ts         satu-satunya permukaan publik fitur ini
└── <fitur>-page.test.tsx
```

Aturannya:

1. **Satu komponen per berkas**, dinamai sama dengan berkasnya. `dashboard-page.tsx` hanya
   berisi kerangka; setiap bagian tinggal di berkasnya sendiri. Berkas 680 baris berisi
   tujuh komponen adalah keadaan yang baru saja ditinggalkan, bukan pola.
2. **Berkas komponen hanya mengekspor komponen.** Konstanta dan fungsi pembantu pindah ke
   berkas `.ts` sendiri — itulah sebabnya `time-range.ts` terpisah dari
   `time-range-menu.tsx`. Aturan `react-refresh/only-export-components` menegakkan ini,
   dan alasannya nyata: fast refresh mati untuk seluruh berkas kalau dilanggar.
3. **Penamaan:** komponen `kebab-case.tsx`, hook `use-kebab-case.ts`, named export
   (bukan default) kecuali untuk halaman.
4. **Impor lintas fitur hanya lewat `index.ts`.** Menjangkau ke dalam
   `features/x/components/...` dari fitur lain berarti batasnya salah tempat.
   Siklus `features/cashier` ↔ `features/ppob` yang pernah ada sudah dilunasi:
   `useCartStore` tinggal di `src/stores/cart-store.ts` (state yang dipakai dua fitur
   bukan milik salah satunya), dan `PpobQuickAccess` pulang ke
   `features/ppob/components/quick-access/` lalu diekspor lewat `features/ppob/index.ts`.
   Berkas jembatan di `features/cashier/` sudah dihapus.

   Satu pengecualian yang disengaja: **`app/router.tsx` boleh `lazy()`-import modul
   halaman langsung** (`features/ppob/components/ppob-page`), bukan barrel-nya. Barrel
   sebuah fitur juga mengekspor komponen yang dimuat _eager_ oleh fitur lain
   (`PpobQuickAccess` oleh kasir); kalau router memuat halaman lewat barrel yang sama,
   seluruh pohon fitur ikut masuk chunk pemanggilnya dan batas `lazy()` jadi percuma.
   Karena itu barrel hanya berisi yang memang dimaksudkan untuk dipakai fitur lain —
   halaman tidak.

5. **Yang dipakai lebih dari satu fitur** naik ke `src/components/` (komponen) atau
   `src/lib/` (fungsi murni). `formatNumber` pindah ke `src/lib/format.ts` justru karena
   dashboard bukan satu-satunya yang butuh.
6. Panggilan API tinggal di `src/lib/api/<resource>.ts`, kunci cache di
   `src/lib/api/query-keys.ts`. Tidak ada `fetch` langsung di dalam komponen.

## 9. Kanso: apa yang dibuang, dan kenapa

`簡素` — kesederhanaan yang didapat dengan membuang, bukan dengan menambah yang polos.
Aturan kerjanya: **kalau elemennya bisa hilang tanpa ada informasi yang ikut hilang, ia
memang harus hilang.** Sebelum menambahkan sesuatu ke layar, tanyakan informasi apa yang
ia bawa yang belum dibawa tetangganya.

Yang dibuang pada penyisiran terakhir, semuanya improvisasi yang tidak diminta brief-nya:

| Dibuang                                      | Alasan                                      |
| -------------------------------------------- | ------------------------------------------- |
| Baris keterangan di tiap kartu KPI           | mengulang label kartunya                    |
| Lencana jumlah baris di tiap judul tabel     | angkanya sudah kelihatan dari isi tabelnya  |
| `Chip` metode pembayaran di tiap baris tabel | sepuluh lencana per layar, nol informasi    |
| `p-5` dan rentetan `mt-*` di dalam kartu     | melawan `Card` yang sudah mengatur jarak    |
| `text-base` pada `Card.Title`                | membesarkan judul yang bukan hierarki utama |
| Garis putus-putus pada grid grafik           | dua pola garis untuk satu garis bantu       |
| Peran pengguna dan pemisah `·` di kepala     | identitas sudah ada di sidebar              |
| `variant="outline"` pada tombol ikon         | nama rupa; `tertiary` menyatakan perannya   |

Yang **tidak** dibuang meski menggoda: sumbu-Y pada kedua grafik (tanpanya besaran
batangnya tidak terbaca), legenda bertulisan pada grafik metode (warna saja bukan pembeda
yang boleh berdiri sendiri), dan `StatusBadge` (statusnya memang informasi baru).

## 10. Catatan keputusan

**Radar chart dibuang.** Ia memberi satu bentuk untuk satu hari dan tidak bisa menjawab
pertanyaan yang sebenarnya ditanyakan pemilik toko — apakah QRIS naik terhadap tunai —
karena sumbunya tidak punya waktu. Penggantinya butuh endpoint baru,
`GET /api/dashboard/payment-methods/daily`.

**Kartu "Aksi Cepat" dibubarkan.** Empat tombol setinggi 112 px memakan satu baris penuh
untuk tautan yang seluruhnya sudah ada di sidebar.

**Geist dipertahankan meski contoh HeroUI memakai Inter.** Aplikasi ini harus bisa jalan
tanpa internet.

**`shadcn` dicabut sepenuhnya — catatan sebelumnya di sini salah.** Dokumen ini pernah
menyatakan paket itu wajib tinggal karena `index.css` mengimpor `shadcn/tailwind.css` dan
mencabutnya mematikan build CSS. Yang benar: berkas itu hanya berisi keyframes accordion,
custom variant `data-open` / `data-closed` / `data-selected`, dan utilitas `no-scrollbar` —
nol pemakaian di seluruh `src/`. Yang sungguh-sungguh mematikan build hanyalah satu baris
`outline-ring/50` di `@layer base`, konvensi shadcn yang menunjuk `--ring`; aturan itu
dilepas karena setiap komponen HeroUI menggambar cincin fokusnya sendiri lewat
`status-focused`.

**Sidebar dibangun tangan, dan memang harus.** HeroUI v3 tidak punya komponen navigasi —
71 komponen, tidak satu pun sidebar, navbar, atau menu navigasi. Yang dipakai adalah
primitifnya: `Disclosure` untuk grup yang melipat, `Drawer` untuk mode ponsel, `Tooltip`
untuk label saat rail menyempit, `Dropdown` + `Avatar` untuk menu pengguna. Baris menunya
mengikuti bentuk `.list-box-item` HeroUI (`rounded-2xl`, `gap-3`, hover `bg-default`),
bukan bentuk shadcn yang dipakai sebelumnya.

**Beranda Mitra Indogrosir dibelah dua: menu di kiri, riwayat di kanan.** Riwayat
transaksi PPOB pernah jadi sub-halaman di balik tombol "Riwayat" di navbar, padahal yang
ditanyakan kasir setelah menekan satu ubin layanan hampir selalu "sudah masuk belum?" —
dua layar untuk satu pekerjaan. Sekarang `ppob-home.tsx` menggambar `grid lg:grid-cols-2`:
saldo dan kisi layanan di kiri (menempel saat digulir, karena kolomnya jauh lebih pendek),
`HistoryPanel` sebagai `Card` di kanan, dan di bawah `lg` keduanya bertumpuk. Tombol
"Riwayat" dan rute `/ppob/history` hilang; `SaldoBar` di panel kasir menuju `/ppob`. Kisi
layanan karena itu memakai `auto-fill`, bukan breakpoint viewport — lebarnya kini
ditentukan panelnya, sama seperti kisi ringkas di kasir.

**Pengaturan Mitra pindah dari tab Pengaturan ke `/ppob/settings`.** Kredensial, markup,
dan harga jual pulsa adalah urusan layar PPOB, bukan urusan pengaturan toko; tab itu juga
membuat pemilik bolak-balik dua menu sidebar untuk satu vendor. Jalan masuknya tombol
"Pengaturan" `sm tertiary` di kanan atas beranda PPOB, hanya untuk admin; rutenya di
balik `AdminRouteGuard` yang sama dengan `/settings` (`/ppob/settings` masuk
`ADMIN_ONLY_PREFIXES`). Formulirnya dipecah: `use-ppob-settings-form.ts` memegang state
dan kedua mutasi, `connection-card.tsx` dan `markup-card.tsx` menggambarnya, dan tombol
Simpan di kedua kartu tetap menulis seluruh formulir.

**Persentase porsi dihitung terhadap jumlah nilai mutlak.** Nilai bersih bisa negatif
ketika retur melampaui penjualan; memakai jumlah bertanda akan membuat porsinya melebihi
100% begitu ada satu baris negatif.

**Cari layanan di beranda PPOB mengganti kisi, bukan membuka popover.** "Kalau mau bayar
Indihome, di Mitra ada fitur cari" — jawabannya bukan `Autocomplete`/`ComboBox` di atas
kisi "Pilih Layanan", karena hasilnya (biller Payment Point dari lintas grup, plus layanan
tetap yang namanya cocok) sama-sama "sesuatu yang bisa ditekan untuk membuka satu flow",
jadi bentuknya harus tetap ubin, bukan baris teks di popover yang mendadak beda dari
tetangganya begitu ada kueri. `ppob-home.tsx` memasang `SearchField` (`SearchInput`) di
atas kisi; kisi itu sendiri, saat kosong, tetap `ServiceGrid` seperti biasa, dan saat ada
kueri berganti ke `SearchResultsGrid` — hasil biller (`GET
/ppob/catalog/payment-points/search`, di-debounce 300 ms seperti pencarian lain) plus
tile layanan tetap yang labelnya cocok, digambar dengan `TileButton`/`TileGrid` yang sama,
supaya mata tidak perlu belajar bentuk kedua untuk "ini juga bisa ditekan". `NoData` untuk
kueri yang tidak cocok apa pun. Backend membangun daftar biller sekali (satu putaran
`pp/get-sub-menu` per grup) dan menyimpannya 12 jam
(`services::ppob::search::payment_point_index`) karena upstream tidak punya pencarian
sendiri — mengulang putaran itu per ketikan akan mengalikan panggilan ke Mitra dengan
jumlah huruf yang diketik kasir.

**`TileButton`/`TileGrid` naik dari `ServiceGrid` menjadi milik bersama.** Sebelum ini
`ServiceGrid` menulis `Button` dengan kelas `.tile` dan kisi `auto-fill`-nya sendiri;
`SearchResultsGrid` butuh persis bentuk yang sama untuk hasil biller di sebelah tile
layanan yang cocok, jadi keduanya naik jadi komponen sendiri (`tile-button.tsx`,
`tile-grid.tsx`) alih-alih ditulis ulang. `ServiceGrid` sendiri tidak berubah bentuknya —
ia kini menggambar lewat `TileButton`/`TileGrid` alih-alih markup sendiri.

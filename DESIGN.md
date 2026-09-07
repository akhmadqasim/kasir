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

| Token | Dipakai untuk |
| --- | --- |
| `--background` | kanvas halaman dan sidebar |
| `--surface` | kartu dan panel di atas kanvas |
| `--surface-secondary`, `--surface-tertiary` | permukaan bertingkat di dalam kartu |
| `--overlay` | dialog, popover, menu |
| `--foreground` | teks utama |
| `--muted` | teks sekunder, label, satuan |
| `--default` | latar netral: hover, chip diam, wadah tab |
| `--accent` | warna merek; aksi utama, garis grafik pertama, tab terpilih |
| `--success` / `--warning` / `--danger` | naik / perlu perhatian / turun & rusak |
| `--border`, `--separator` | garis tepi dan garis pemisah |
| `--field-*` | latar, teks, placeholder, dan tepi kolom isian |

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
(lihat `METHOD_COLORS` di `payment-trend-chart.tsx`). Kalau dibagi berurutan, satu hari
tanpa QRIS akan menggeser seluruh warna dan kasir yang hafal "garis biru itu tunai"
membaca grafik yang salah.

### 3.4 Tipografi

Satu keluarga huruf: **Geist Variable**, dimuat lokal lewat `@fontsource-variable/geist`.
Bukan Inter seperti contoh di dokumentasi HeroUI — aplikasi ini harus jalan tanpa internet,
jadi huruf yang diambil dari CDN tidak boleh dipakai.

Hanya tiga peran yang boleh menimpa ukuran huruf bawaan komponen. Sisanya memakai apa yang
sudah diberikan HeroUI.

| Peran | Kelas |
| --- | --- |
| Judul halaman | `text-2xl font-semibold tracking-tight` |
| Angka KPI | `text-3xl font-semibold tracking-tight tabular-nums` |
| Angka sekunder di kepala grafik | `text-xl font-semibold tracking-tight tabular-nums` |

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

`--radius` bernilai `0.75rem` — satu-satunya angka bentuk yang kita tetapkan. Skala
`--radius-sm..4xl` **tidak** ditulis ulang: dulu ada override di `@theme inline` yang
mempertahankan rasio shadcn, dan itu sudah dilepas. Sekarang kelengkungan seluruh aplikasi
berubah dengan mengubah satu angka ini.

Halaman **tidak menambahkan padding luarnya sendiri**. `app-layout` sudah memberi `p-4`;
halaman hanya mengatur `gap` antar bagian.

### 3.6 Ikon

`lucide-react` saja. Ukurannya diwarisi dari komponen HeroUI; hanya beri `className="size-*"`
kalau ikonnya berdiri di luar tombol atau chip.

## 4. Komponen

**HeroUI v3 untuk semua komponen dasar.** Satu-satunya pengecualian adalah
`src/components/ui/chart.tsx`, pembungkus recharts warisan shadcn, dan itu ada karena
HeroUI memang tidak punya grafik. Jangan menambah pengecualian kedua; kalau HeroUI tidak
punya sesuatu, bangun dari primitifnya.

Jangan tulis ulang komponen yang sudah ada. Sebelum membuat yang baru, periksa daftar
komponen HeroUI — kalau MCP server-nya aktif (`.mcp.json`), `list_components` dan
`get_component_docs` menjawab lebih cepat daripada menebak.

### 4.1 Varian mengikuti makna, bukan rupa

Ini prinsip nomor satu HeroUI v3: nama varian menyatakan **peran** sebuah aksi, bukan
gambarannya. Pilih varian dari pertanyaan "seberapa penting aksi ini", bukan "saya ingin
tombolnya bergaris atau terisi".

| `Button` | Untuk | Banyaknya |
| --- | --- | --- |
| `primary` (bawaan) | aksi utama yang memajukan pekerjaan | **satu per konteks** |
| `secondary` | aksi alternatif | boleh beberapa |
| `tertiary` | aksi ringan atau membatalkan | secukupnya |
| `danger` / `danger-soft` | aksi merusak | saat perlu |

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

### 4.2 Komponen bersama milik dashboard

| Berkas | Tugas |
| --- | --- |
| `stat-card.tsx` | satu kartu KPI; `delta` untuk tren, `note` untuk lencana netral |
| `inline-stat.tsx` | angka sekunder di kepala kartu grafik |
| `section-card.tsx` | pembungkus daftar: judul lalu isi; plus `NoData` |
| `time-range.ts` / `time-range-select.tsx` | pilihan rentang waktu, dipakai bersama |

## 5. Pola

### 5.1 Susunan halaman

```
Kepala halaman   — judul/sapaan, keadaan, satu aksi utama di kanan
Baris kendali    — tab di kiri, filter dan muat-ulang di kanan
Isi              — kartu, grafik, tabel
```

Aksi cepat naik ke kepala halaman sebagai tombol ikon, bukan turun sebagai kartu berisi
tombol-tombol besar. Tujuannya sudah ada di sidebar; yang benar-benar ditekan tiap pagi
hanya satu, dan itu yang tetap berupa tombol bertulisan.

### 5.2 Tab

Pakai tab ketika satu layar menjawab beberapa pertanyaan yang tidak ditanyakan bersamaan.
Jangan pakai tab untuk memecah satu pekerjaan menjadi langkah — itu wizard.

Panel yang tidak terpilih tidak dirender oleh React Aria. Ini menguntungkan (tidak ada
permintaan jaringan untuk panel yang tidak dilihat) tapi harus diingat saat menulis test:
isinya baru ada setelah tabnya diklik.

### 5.3 Kartu KPI

Tiga hal saja: label, lencana bila ada yang dibandingkan, angka. **Tidak ada baris
keempat.** Keterangan seperti "transaksi selesai" di bawah kartu berjudul "Transaksi Hari
Ini" hanya mengulang labelnya dengan kata lain, dan empat kartu berdampingan yang
masing-masing punya empat baris membuat baris teratas dashboard terasa penuh sebelum
satu angka pun terbaca.

Empat kartu per baris di layar lebar, dua di tablet, satu di ponsel. Tanpa gradasi, tanpa
bayangan tambahan, tanpa paragraf di kaki kartu.

### 5.4 Tabel

Selalu `Table` HeroUI di dalam `Table.ScrollContainer`, dengan `aria-label` pada
`Table.Content` — label itulah yang dipakai test untuk menemukan tabelnya, jadi jangan
diubah tanpa alasan. Kolom nominal rata kanan dan `tabular-nums`; kolom teks boleh
`truncate` dengan `max-w-*`.

Keadaan kosong lewat `renderEmptyState={() => <NoData />}`, bukan satu baris ber-`colSpan`.

**Sel berisi teks tetap teks.** Metode pembayaran di tabel transaksi pernah dibungkus
`Chip`; sepuluh baris berarti sepuluh lencana, dan lencana berhenti berarti apa-apa ketika
setiap baris punya satu. Lencana disimpan untuk yang benar-benar status — `StatusBadge`
pada transaksi yang belum tuntas dan pada stok yang habis.

### 5.5 Grafik

Batang untuk nilai per hari kalender; garis untuk sesuatu yang benar-benar mengalir antar
titik. Sumbu-x hari kalender **tidak** digambar sebagai garis: garis di antara dua hari
menyiratkan nilai antara yang tidak pernah ada.

Setiap grafik punya keadaan kosong setinggi grafiknya sendiri, supaya tata letak tidak
melompat saat data datang.

### 5.6 Keadaan memuat, kosong, dan gagal

Kosong: kalimat pendek dari `t.dashboard.noData`, rata tengah. Gagal: pesan dari
`ApiError`, jangan pernah menampilkan pesan mentah dari `Database`/`Internal` — keduanya
sudah diredaksi di sisi server dan yang asli hanya masuk log.

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
  *dan* angkanya; garis grafik memakai warna *dan* legenda bertulisan.

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
   `time-range-select.tsx`. Aturan `react-refresh/only-export-components` menegakkan ini,
   dan alasannya nyata: fast refresh mati untuk seluruh berkas kalau dilanggar.
3. **Penamaan:** komponen `kebab-case.tsx`, hook `use-kebab-case.ts`, named export
   (bukan default) kecuali untuk halaman.
4. **Impor lintas fitur hanya lewat `index.ts`.** Menjangkau ke dalam
   `features/x/components/...` dari fitur lain berarti batasnya salah tempat.
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

| Dibuang | Alasan |
| --- | --- |
| Baris keterangan di tiap kartu KPI | mengulang label kartunya |
| Lencana jumlah baris di tiap judul tabel | angkanya sudah kelihatan dari isi tabelnya |
| `Chip` metode pembayaran di tiap baris tabel | sepuluh lencana per layar, nol informasi |
| `p-5` dan rentetan `mt-*` di dalam kartu | melawan `Card` yang sudah mengatur jarak |
| `text-base` pada `Card.Title` | membesarkan judul yang bukan hierarki utama |
| Garis putus-putus pada grid grafik | dua pola garis untuk satu garis bantu |
| Peran pengguna dan pemisah `·` di kepala | identitas sudah ada di sidebar |
| `variant="outline"` pada tombol ikon | nama rupa; `tertiary` menyatakan perannya |

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

**Persentase porsi dihitung terhadap jumlah nilai mutlak.** Nilai bersih bisa negatif
ketika retur melampaui penjualan; memakai jumlah bertanda akan membuat porsinya melebihi
100% begitu ada satu baris negatif.

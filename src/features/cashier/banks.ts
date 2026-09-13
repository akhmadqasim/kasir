import alloBankLogo from "@/assets/banks/allo-bank.svg"
import amarBankLogo from "@/assets/banks/amar-bank.png"
import bankAcehLogo from "@/assets/banks/bank-aceh.png"
import bankDkiLogo from "@/assets/banks/bank-dki.svg"
import bankJagoLogo from "@/assets/banks/bank-jago.svg"
import bankJatengLogo from "@/assets/banks/bank-jateng.png"
import bankJatimLogo from "@/assets/banks/bank-jatim.svg"
import bankKaltimtaraLogo from "@/assets/banks/bank-kaltimtara.png"
import bankLampungLogo from "@/assets/banks/bank-lampung.png"
import bankMegaLogo from "@/assets/banks/bank-mega.svg"
import bankNagariLogo from "@/assets/banks/bank-nagari.svg"
import bankNeoCommerceLogo from "@/assets/banks/bank-neo-commerce.png"
import bankNtbSyariahLogo from "@/assets/banks/bank-ntb-syariah.png"
import bankRayaLogo from "@/assets/banks/bank-raya.svg"
import bankRiauKepriLogo from "@/assets/banks/bank-riau-kepri.png"
import bankSaquLogo from "@/assets/banks/bank-saqu.png"
import bankSulselbarLogo from "@/assets/banks/bank-sulselbar.png"
import bankSumselBabelLogo from "@/assets/banks/bank-sumsel-babel.png"
import bankSumutLogo from "@/assets/banks/bank-sumut.png"
import bcaLogo from "@/assets/banks/bca.svg"
import bjbLogo from "@/assets/banks/bjb.svg"
import bluBcaLogo from "@/assets/banks/blu-bca.svg"
import bniLogo from "@/assets/banks/bni.svg"
import briLogo from "@/assets/banks/bri.svg"
import bsiLogo from "@/assets/banks/bsi.svg"
import btnLogo from "@/assets/banks/btn.svg"
import cimbNiagaLogo from "@/assets/banks/cimb-niaga.svg"
import danaLogo from "@/assets/banks/dana.svg"
import danamonLogo from "@/assets/banks/danamon.svg"
import dbsLogo from "@/assets/banks/dbs.svg"
import gopayLogo from "@/assets/banks/gopay.svg"
import hibankLogo from "@/assets/banks/hibank.svg"
import hsbcLogo from "@/assets/banks/hsbc.svg"
import jeniusLogo from "@/assets/banks/jenius.png"
import kbBankLogo from "@/assets/banks/kb-bank.svg"
import kromBankLogo from "@/assets/banks/krom-bank.png"
import lineBankLogo from "@/assets/banks/line-bank.png"
import linkajaLogo from "@/assets/banks/linkaja.svg"
import mandiriLogo from "@/assets/banks/mandiri.svg"
import maybankLogo from "@/assets/banks/maybank.png"
import ocbcLogo from "@/assets/banks/ocbc.svg"
import ovoLogo from "@/assets/banks/ovo.svg"
import paninLogo from "@/assets/banks/panin.svg"
import permataLogo from "@/assets/banks/permata.svg"
import seabankLogo from "@/assets/banks/seabank.svg"
import shopeepayLogo from "@/assets/banks/shopeepay.png"
import sinarmasLogo from "@/assets/banks/sinarmas.png"
import superbankLogo from "@/assets/banks/superbank.svg"
import uobLogo from "@/assets/banks/uob.svg"

/**
 * Bank dan e-wallet yang mungkin muncul di kolom "Bank" transfer — daftar
 * awal untuk `Autocomplete`, bukan daftar tertutup: `allowsCustomValue` di
 * komponennya tetap menerima nama yang tidak ada di sini (BPD kecil, bank baru).
 *
 * Diurutkan berdasarkan seberapa sering dipakai pelanggan toko sembako lebih
 * dulu (bank nasional besar, lalu e-wallet), baru alfabetis untuk sisanya —
 * bukan alfabetis penuh, supaya BCA tidak tenggelam di antara puluhan BPD.
 *
 * `code` adalah kode bank SKN/RTGS standar (3 digit) kalau ada; e-wallet tidak
 * punya kode bank sehingga `code` kosong. Nama dan kode diverifikasi lewat
 * pencarian terhadap data OJK/BI 2026 — beberapa institusi berganti nama
 * legal belakangan ini (mis. BTPN → SMBC Indonesia, Bukopin → KB Bank) tapi
 * tetap didaftar dengan nama yang sehari-hari dikenal kasir (Jenius, KB Bank).
 */
export type BankKind = "bank" | "ewallet"

export interface Bank {
  name: string
  /** Bank sungguhan (punya rekening) atau dompet digital; default `"bank"`. */
  kind?: BankKind
  /** Kode bank SKN/RTGS 3 digit, kalau ada satu yang baku. */
  code?: string
  /** Kata kunci lain yang mungkin diketik kasir, huruf kecil semua. */
  aliases?: readonly string[]
  /** URL logo yang diimpor Vite, kalau ada satu di `BANK_LOGOS` untuk nama ini. */
  logo?: string
}

const BANKS_BASE: readonly Omit<Bank, "logo">[] = [
  // --- Paling umum diterima toko sembako -----------------------------------
  { name: "BCA", code: "014", aliases: ["bca", "bank central asia"] },
  { name: "Mandiri", code: "008", aliases: ["mandiri", "bank mandiri"] },
  { name: "BRI", code: "002", aliases: ["bri", "bank rakyat indonesia"] },
  { name: "BNI", code: "009", aliases: ["bni", "bank negara indonesia"] },
  { name: "BSI", code: "451", aliases: ["bsi", "syariah", "bank syariah indonesia"] },
  { name: "BTN", code: "200", aliases: ["btn", "bank tabungan negara"] },
  { name: "CIMB Niaga", code: "022", aliases: ["cimb", "niaga"] },
  { name: "Danamon", code: "011", aliases: ["danamon"] },
  { name: "Permata", code: "013", aliases: ["permata", "bank permata"] },
  { name: "GoPay", kind: "ewallet", aliases: ["gopay", "go-pay"] },
  { name: "OVO", kind: "ewallet", aliases: ["ovo"] },
  { name: "DANA", kind: "ewallet", aliases: ["dana"] },
  { name: "ShopeePay", kind: "ewallet", aliases: ["shopeepay", "shopee pay"] },
  { name: "LinkAja", kind: "ewallet", aliases: ["linkaja", "link aja"] },

  // --- Sisanya, alfabetis ---------------------------------------------------
  { name: "Allo Bank", code: "567", aliases: ["allo", "allobank"] },
  { name: "Amar Bank", code: "531", aliases: ["amar", "tunaiku"] },
  { name: "Bank Aceh", code: "116", aliases: ["aceh", "bank aceh syariah"] },
  { name: "Bank DKI", code: "111", aliases: ["dki"] },
  { name: "Bank Jago", code: "542", aliases: ["jago"] },
  { name: "Bank Jateng", code: "113", aliases: ["jateng"] },
  { name: "Bank Jatim", code: "114", aliases: ["jatim"] },
  { name: "Bank Kaltimtara", code: "124", aliases: ["kaltim", "kaltimtara"] },
  { name: "Bank Lampung", code: "121", aliases: ["lampung"] },
  { name: "Bank Mega", code: "426", aliases: ["mega"] },
  { name: "Bank Nagari", code: "118", aliases: ["nagari", "sumbar"] },
  { name: "Bank Neo Commerce", code: "490", aliases: ["neo", "neobank", "bnc"] },
  { name: "Bank NTB Syariah", code: "128", aliases: ["ntb"] },
  { name: "Bank Raya", code: "494", aliases: ["raya"] },
  { name: "Bank Riau Kepri", code: "119", aliases: ["riau", "kepri"] },
  { name: "Bank Saqu", aliases: ["saqu"] },
  { name: "Bank Sulselbar", code: "126", aliases: ["sulselbar", "sulsel"] },
  { name: "Bank Sumsel Babel", code: "120", aliases: ["sumsel", "babel"] },
  { name: "Bank Sumut", code: "117", aliases: ["sumut"] },
  { name: "BJB", code: "110", aliases: ["bjb", "bank jabar banten", "jabar", "banten"] },
  { name: "blu by BCA", code: "501", aliases: ["blu", "blu bca"] },
  { name: "DBS Indonesia", code: "046", aliases: ["dbs", "digibank"] },
  { name: "Hibank", code: "553", aliases: ["hibank", "hi bank"] },
  { name: "HSBC Indonesia", code: "041", aliases: ["hsbc"] },
  { name: "Jenius", code: "213", aliases: ["jenius", "btpn", "smbc", "smbc indonesia"] },
  { name: "KB Bank", code: "441", aliases: ["bukopin", "kb bukopin", "kb bank indonesia"] },
  { name: "Krom Bank", code: "459", aliases: ["krom", "bank bisnis internasional"] },
  { name: "Line Bank", aliases: ["line bank", "hana", "keb hana"] },
  { name: "Maybank Indonesia", code: "016", aliases: ["maybank"] },
  { name: "OCBC", code: "028", aliases: ["ocbc", "ocbc nisp", "nisp"] },
  { name: "Panin", code: "019", aliases: ["panin", "bank panin"] },
  { name: "SeaBank", code: "535", aliases: ["seabank", "sea bank"] },
  { name: "Sinarmas", code: "153", aliases: ["sinarmas", "bank sinarmas"] },
  { name: "Superbank", code: "562", aliases: ["superbank"] },
  { name: "UOB Indonesia", code: "023", aliases: ["uob"] },
] as const

/**
 * Logo per nama bank, dari `src/assets/banks/` — lihat `SOURCES.md` di
 * situ untuk sumber dan lisensi tiap berkas. Bukan semua bank di `BANKS`
 * punya entri di sini: yang logonya tidak ditemukan dari sumber resmi
 * (Wikimedia Commons, situs resmi, atau koleksi logo terbuka) sengaja
 * dibiarkan tanpa logo — `BankLogo` jatuh ke ikon `Landmark` netral, bukan
 * gambar karangan.
 */
export const BANK_LOGOS: Partial<Record<string, string>> = {
  BCA: bcaLogo,
  Mandiri: mandiriLogo,
  BRI: briLogo,
  BNI: bniLogo,
  BSI: bsiLogo,
  BTN: btnLogo,
  "CIMB Niaga": cimbNiagaLogo,
  Danamon: danamonLogo,
  Permata: permataLogo,
  GoPay: gopayLogo,
  OVO: ovoLogo,
  DANA: danaLogo,
  ShopeePay: shopeepayLogo,
  LinkAja: linkajaLogo,
  "Allo Bank": alloBankLogo,
  "Amar Bank": amarBankLogo,
  "Bank Aceh": bankAcehLogo,
  "Bank DKI": bankDkiLogo,
  "Bank Jago": bankJagoLogo,
  "Bank Jateng": bankJatengLogo,
  "Bank Jatim": bankJatimLogo,
  "Bank Kaltimtara": bankKaltimtaraLogo,
  "Bank Lampung": bankLampungLogo,
  "Bank Mega": bankMegaLogo,
  "Bank Nagari": bankNagariLogo,
  "Bank Neo Commerce": bankNeoCommerceLogo,
  "Bank NTB Syariah": bankNtbSyariahLogo,
  "Bank Raya": bankRayaLogo,
  "Bank Riau Kepri": bankRiauKepriLogo,
  "Bank Saqu": bankSaquLogo,
  "Bank Sulselbar": bankSulselbarLogo,
  "Bank Sumsel Babel": bankSumselBabelLogo,
  "Bank Sumut": bankSumutLogo,
  BJB: bjbLogo,
  "blu by BCA": bluBcaLogo,
  "DBS Indonesia": dbsLogo,
  Hibank: hibankLogo,
  "HSBC Indonesia": hsbcLogo,
  Jenius: jeniusLogo,
  "KB Bank": kbBankLogo,
  "Krom Bank": kromBankLogo,
  "Line Bank": lineBankLogo,
  "Maybank Indonesia": maybankLogo,
  OCBC: ocbcLogo,
  Panin: paninLogo,
  SeaBank: seabankLogo,
  Sinarmas: sinarmasLogo,
  Superbank: superbankLogo,
  "UOB Indonesia": uobLogo,
}

export const BANKS: readonly Bank[] = BANKS_BASE.map((bank) => ({
  ...bank,
  logo: BANK_LOGOS[bank.name],
}))

/**
 * Apa yang ditanyakan kolom "bank" untuk tiap metode pembayaran selain tunai —
 * daftar yang ditawarkan dan placeholder-nya. Transfer bisa datang dari
 * rekening bank maupun dompet digital (DANA → rekening toko), debit selalu
 * kartu bank, e-wallet selalu dompet digital, dan QRIS dibayar dari aplikasi
 * mana saja — semua tetap `allowsCustomValue`, ini cuma urutan tawaran.
 */
export interface BankChoice {
  placeholder: string
  options: readonly Bank[]
}

const ONLY_BANKS = BANKS.filter((bank) => (bank.kind ?? "bank") === "bank")
const ONLY_EWALLETS = BANKS.filter((bank) => bank.kind === "ewallet")

export const BANK_CHOICE_BY_METHOD: Partial<Record<string, BankChoice>> = {
  transfer: { placeholder: "Bank pengirim", options: BANKS },
  debit: { placeholder: "Bank kartu", options: ONLY_BANKS },
  ewallet: { placeholder: "Dompet digital", options: ONLY_EWALLETS },
  qris: { placeholder: "Aplikasi pembayar", options: BANKS },
}

/** Cocok untuk `ComboBox`'s `defaultFilter`: nama bank atau salah satu aliasnya. */
export function bankMatchesQuery(bank: Bank, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (bank.name.toLowerCase().includes(q)) return true
  return (bank.aliases ?? []).some((alias) => alias.includes(q))
}

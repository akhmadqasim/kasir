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
export interface Bank {
  name: string
  /** Kode bank SKN/RTGS 3 digit, kalau ada satu yang baku. */
  code?: string
  /** Kata kunci lain yang mungkin diketik kasir, huruf kecil semua. */
  aliases?: readonly string[]
}

export const BANKS: readonly Bank[] = [
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
  { name: "GoPay", aliases: ["gopay", "go-pay"] },
  { name: "OVO", aliases: ["ovo"] },
  { name: "DANA", aliases: ["dana"] },
  { name: "ShopeePay", aliases: ["shopeepay", "shopee pay"] },
  { name: "LinkAja", aliases: ["linkaja", "link aja"] },

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

/** Cocok untuk `ComboBox`'s `defaultFilter`: nama bank atau salah satu aliasnya. */
export function bankMatchesQuery(bank: Bank, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (bank.name.toLowerCase().includes(q)) return true
  return (bank.aliases ?? []).some((alias) => alias.includes(q))
}

/**
 * Angka sekunder di dalam kepala kartu grafik: nilainya besar, labelnya kecil
 * di bawahnya.
 *
 * Urutannya sengaja nilai dulu baru label. Mata membaca baris ini untuk
 * angkanya; labelnya hanya dibutuhkan sesudah angka itu menarik perhatian.
 */
export function InlineStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  )
}

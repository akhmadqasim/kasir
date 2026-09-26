import type { ReactNode } from "react"

/**
 * Angka sekunder di dalam kepala kartu grafik: nilainya besar, labelnya kecil
 * di bawahnya.
 *
 * Urutannya sengaja nilai dulu baru label. Mata membaca baris ini untuk
 * angkanya; labelnya hanya dibutuhkan sesudah angka itu menarik perhatian.
 *
 * `value` boleh `ReactNode` supaya kartu yang masih memuat menaruh `Skeleton`
 * di baris angkanya — karena itu pembungkusnya `div`, bukan `p`.
 */
export function InlineStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="flex h-7 items-center text-xl font-semibold tracking-tight tabular-nums">
        {value}
      </div>
      <p className="text-xs text-muted">{label}</p>
    </div>
  )
}

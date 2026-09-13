import { Separator } from "@heroui/react"
import { Check } from "lucide-react"
import { id } from "@/i18n/id"
import { cn } from "@/lib/utils"

/**
 * Urutan langkah penyiapan. Nomor yang tampil diturunkan dari urutan di sini,
 * jadi menambah langkah tidak menuntut ada angka yang ikut diperbarui di tempat
 * lain.
 */
const STEPS = [
  { id: "store", label: id.onboarding.storeInfo },
  { id: "admin", label: id.onboarding.stepAdmin },
] as const

type StepId = (typeof STEPS)[number]["id"]

type StepStatus = "done" | "current" | "upcoming"

const MARKER_TONE: Record<StepStatus, string> = {
  current: "bg-accent text-accent-foreground",
  done: "bg-accent-soft text-accent-soft-foreground",
  upcoming: "bg-default text-muted",
}

const LABEL_TONE: Record<StepStatus, string> = {
  current: "font-medium text-foreground",
  done: "text-muted",
  upcoming: "text-muted",
}

interface OnboardingStepsProps {
  /** Langkah yang sedang dikerjakan. */
  current: StepId
}

/**
 * Penunjuk langkah penyiapan.
 *
 * HeroUI v3 tidak punya Stepper — 71 komponennya tidak memuat satu pun — jadi
 * bentuknya dirakit dari primitif seperti yang DESIGN.md §4 minta: `Separator`
 * sebagai garis penghubung, sisanya token semantik. Daftarnya `<ol>` supaya
 * pembaca layar mengumumkan posisi langkahnya, dan yang sedang dikerjakan
 * ditandai `aria-current="step"`.
 *
 * Keadaan langkah tidak dibedakan warna saja (DESIGN.md §7): yang sudah lewat
 * menukar angkanya dengan centang, yang sedang dikerjakan memakai lingkaran
 * aksen penuh dan label tebal.
 */
export function OnboardingSteps({ current }: OnboardingStepsProps) {
  const currentIndex = STEPS.findIndex((step) => step.id === current)

  return (
    // `role="list"` ditulis eksplisit: preflight Tailwind memberi `ol`
    // `list-style: none`, dan WebKit membuang peran daftarnya begitu itu terjadi.
    <ol aria-label={id.onboarding.steps} className="flex items-center gap-2" role="list">
      {STEPS.map(({ id: stepId, label }, index) => {
        const status: StepStatus =
          index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming"

        return (
          <li
            key={stepId}
            aria-current={status === "current" ? "step" : undefined}
            className="flex flex-1 items-center gap-2 first:flex-none"
          >
            {/* `aria-hidden` harus duduk di pembungkusnya: React Aria menyaring
                prop `Separator` lewat `filterDOMProps`, dan `aria-hidden` tidak
                ada di allowlist-nya — garisnya akan tetap diumumkan sebagai
                `role="separator"` di tengah butir daftar. */}
            {index > 0 ? (
              <span aria-hidden="true" className="flex flex-1 items-center">
                <Separator className="flex-1" />
              </span>
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums",
                MARKER_TONE[status],
              )}
            >
              {status === "done" ? <Check className="size-3.5" /> : index + 1}
            </span>
            <span className={cn("text-xs whitespace-nowrap", LABEL_TONE[status])}>{label}</span>
            {status === "done" ? <span className="sr-only">{id.onboarding.stepDone}</span> : null}
          </li>
        )
      })}
    </ol>
  )
}

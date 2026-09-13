import { isRouteErrorResponse } from "react-router-dom"

import { useAuthStore } from "@/features/auth/hooks/use-auth-store"
import type { User } from "@/features/auth/types"
import { id as t } from "@/i18n/id"
import { isApiError } from "@/lib/api/client"
import { getDefaultRouteForRole } from "./resume-route"

export type RouteErrorKind = "not-found" | "forbidden" | "crash"

export interface RouteErrorDescription {
  kind: RouteErrorKind
  title: string
  description: string
  /** Apa yang dilempar, dalam bentuk yang bisa disalin admin. `null` kalau tidak ada. */
  details: string | null
}

const COPY: Record<RouteErrorKind, Pick<RouteErrorDescription, "title" | "description">> = {
  "not-found": {
    title: t.errorPage.notFoundTitle,
    description: t.errorPage.notFoundDescription,
  },
  forbidden: {
    title: t.errorPage.forbiddenTitle,
    description: t.errorPage.forbiddenDescription,
  },
  crash: {
    title: t.errorPage.crashTitle,
    description: t.errorPage.crashDescription,
  },
}

/**
 * Menerjemahkan apa pun yang sampai ke `useRouteError` menjadi judul, kalimat
 * penjelas, dan detail teknis. `Response` dari router dibaca statusnya: 404
 * berarti alamatnya tidak ada, 401/403 berarti tidak boleh masuk. `ApiError`
 * yang lolos sampai render hanya dianggap "tidak punya akses" bila kodenya
 * memang `forbidden`; 404 dari API berarti datanya yang hilang, bukan
 * halamannya, jadi ia tetap kesalahan biasa — dengan pesan server yang sudah
 * ditulis untuk layar sebagai kalimat penjelasnya.
 */
export function describeRouteError(error: unknown): RouteErrorDescription {
  const kind = kindOf(error)
  const description = kind === "crash" && isApiError(error) ? error.message : COPY[kind].description
  return { kind, title: COPY[kind].title, description, details: formatDetails(error) }
}

function kindOf(error: unknown): RouteErrorKind {
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) return "not-found"
    if (error.status === 401 || error.status === 403) return "forbidden"
    return "crash"
  }
  if (isApiError(error) && error.code === "forbidden") return "forbidden"
  return "crash"
}

/**
 * Yang ditampilkan di kotak detail. Di build dev jejak tumpukan penuh — itu
 * yang dibutuhkan untuk mencari penyebabnya. Di produksi hanya pesannya: jejak
 * tumpukan berisi path berkas dan struktur internal aplikasi yang tidak perlu
 * dipajang di layar kasir, dan bagi admin toko toh tidak bisa dibaca.
 */
function formatDetails(error: unknown): string {
  if (isRouteErrorResponse(error)) {
    return [`${error.status} ${error.statusText}`.trim(), stringify(error.data)]
      .filter(Boolean)
      .join("\n")
  }
  if (error instanceof Error) {
    if (!import.meta.env.DEV) return error.message || t.errorPage.unknownError
    // Chromium sudah menaruh pesan di baris pertama `stack`; WebKit tidak.
    const stack = error.stack ?? ""
    return stack.includes(error.message) ? stack : [error.message, stack].join("\n").trim()
  }
  return stringify(error) || t.errorPage.unknownError
}

function stringify(value: unknown): string {
  if (value == null || value === "") return ""
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export interface HomeAction {
  path: string
  label: string
}

const HOME_LABELS: Record<User["role"], string> = {
  admin: t.errorPage.homeDashboard,
  kasir: t.errorPage.homeCashier,
}

/**
 * Tujuan tombol "kembali" menurut peran yang sedang masuk. Dibaca langsung
 * dari store, bukan lewat hook: halaman error harus tetap bisa digambar kalau
 * yang rusak justru pohon React di atasnya, dan `getState()` tidak butuh
 * provider apa pun. Kalau store-nya sendiri yang bermasalah, jatuh ke `/`.
 */
export function resolveHomeAction(): HomeAction {
  let role: User["role"] | undefined
  try {
    role = useAuthStore.getState().user?.role
  } catch {
    role = undefined
  }

  if (!role) return { path: "/", label: t.errorPage.homeDefault }
  return { path: getDefaultRouteForRole(role), label: HOME_LABELS[role] }
}

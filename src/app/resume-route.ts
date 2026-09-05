import type { User } from "@/features/auth/types"

type UserRole = User["role"]

export const LAST_ROUTE_STORAGE_KEY = "kasir-last-route"

// `/start` no longer exists as a route, but an older release stored it, so keep
// rejecting it rather than letting a stale localStorage value resume onto a 404.
const NON_RESUMABLE_PATHS = new Set(["/", "/start", "/login", "/onboarding"])
const RESUMABLE_PREFIXES = [
  "/cashier",
  "/dashboard",
  "/products",
  "/transactions",
  "/refunds",
  "/stock",
  "/reports",
  "/settings",
  "/users",
  "/ppob",
  "/close-shift",
]
/**
 * Routes a cashier may not open, mirroring the backend's `require_role(.., "admin")`:
 * every mutation behind these screens is admin-only — user CRUD in `auth.rs`, product
 * and category CRUD in `products.rs`/`categories.rs`, and store info, app settings,
 * database export/import and backups in `settings.rs`/`backup.rs`. Read-only commands a
 * cashier does need (`search_products`, `get_product_by_barcode`) live on other screens.
 */
const ADMIN_ONLY_PREFIXES = ["/users", "/products", "/settings"]

function matchesPath(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

function normalizePathname(pathname: string | null | undefined) {
  if (!pathname) return null
  const trimmed = pathname.trim()
  if (!trimmed.startsWith("/")) return null
  return trimmed.replace(/\/+$/, "") || "/"
}

export function getDefaultRouteForRole(role: UserRole) {
  return role === "admin" ? "/dashboard" : "/cashier"
}

export function isResumableRoute(pathname: string | null | undefined) {
  const normalized = normalizePathname(pathname)
  if (!normalized || NON_RESUMABLE_PATHS.has(normalized)) return false
  return RESUMABLE_PREFIXES.some((prefix) => matchesPath(normalized, prefix))
}

export function isAdminOnlyRoute(pathname: string | null | undefined) {
  const normalized = normalizePathname(pathname)
  if (!normalized) return false
  return ADMIN_ONLY_PREFIXES.some((prefix) => matchesPath(normalized, prefix))
}

export function isRouteAllowedForRole(
  pathname: string | null | undefined,
  role: UserRole
) {
  const normalized = normalizePathname(pathname)
  if (!normalized || !isResumableRoute(normalized)) return false
  if (role !== "admin" && isAdminOnlyRoute(normalized)) return false
  return true
}

export function resolveResumeRoute(
  role: UserRole,
  storedRoute: string | null | undefined
) {
  return isRouteAllowedForRole(storedRoute, role)
    ? normalizePathname(storedRoute)!
    : getDefaultRouteForRole(role)
}

export function readStoredResumeRoute(storage: Pick<Storage, "getItem"> = localStorage) {
  try {
    return normalizePathname(storage.getItem(LAST_ROUTE_STORAGE_KEY))
  } catch {
    return null
  }
}

export function storeResumeRoute(
  pathname: string,
  storage: Pick<Storage, "setItem"> = localStorage
) {
  const normalized = normalizePathname(pathname)
  if (!normalized || !isResumableRoute(normalized)) return

  try {
    storage.setItem(LAST_ROUTE_STORAGE_KEY, normalized)
  } catch {
    // Ignore storage failures in desktop environments with restricted storage.
  }
}

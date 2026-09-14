import type { AppSettings } from "@/features/settings/types"

/**
 * What `GET /api/settings` answers, shared by the settings-screen tests and
 * the Mitra Indogrosir settings tests.
 *
 * The PPOB password is absent, and not by omission in this fixture: the
 * endpoint stopped sending it. Only `has_credentials` remains, which says
 * whether one is stored without saying what it is.
 */
export const SETTINGS: AppSettings = {
  sales: { allow_negative_stock: false, default_payment_method: "cash" },
  security: { session_timeout_minutes: 30 },
  ppob: {
    enabled: true,
    phone_number: "081234567890",
    device_id: "device-abc",
    has_credentials: true,
    markup: {
      pulsa: { type: "fixed", value: 1000 },
      data: { type: "fixed", value: 0 },
      pln: { type: "fixed", value: 0 },
      pdam: { type: "fixed", value: 0 },
      bpjs: { type: "fixed", value: 0 },
      emoney: { type: "fixed", value: 0 },
      custom_prices: {},
    },
  },
  backup: { interval_hours: 3, retention_days: 90 },
}

/** The same PPOB block as `PUT /api/settings` accepts it: no `has_credentials`. */
export const WRITABLE_PPOB = {
  enabled: SETTINGS.ppob.enabled,
  phone_number: SETTINGS.ppob.phone_number,
  device_id: SETTINGS.ppob.device_id,
  markup: SETTINGS.ppob.markup,
}

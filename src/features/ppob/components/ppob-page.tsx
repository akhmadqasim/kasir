import { Navigate, Routes, Route } from "react-router-dom"

import { AdminRouteGuard } from "@/app/app-guard"
import { PpobServicePage } from "./ppob-service-page"
import { PpFlow } from "./pp-flow"
import { TransferFlow } from "./transfer-flow"
import { VoucherFlow } from "./voucher-flow"
import { PpobHome } from "./ppob-home"
import { PpobMutasi } from "./mutasi"
import { PpobNotifications } from "./notifications"
import { PpobSettings } from "./settings"

export function PpobPage() {
  return (
    <Routes>
      <Route index element={<PpobHome />} />
      <Route path="pulsa" element={<PpobServicePage service="pulsa" />} />
      <Route path="data" element={<PpobServicePage service="data" />} />
      <Route path="pln" element={<PpobServicePage service="pln" />} />
      <Route path="pdam" element={<PpobServicePage service="pdam" />} />
      <Route path="bpjs" element={<PpobServicePage service="bpjs" />} />
      <Route path="pp" element={<PpFlow />} />
      <Route path="transfer" element={<TransferFlow />} />
      <Route path="emoney" element={<PpobServicePage service="emoney" />} />
      <Route path="voucher" element={<VoucherFlow />} />
      <Route path="mutasi" element={<PpobMutasi />} />
      <Route path="notifications" element={<PpobNotifications />} />
      {/* Pengaturan Mitra mengubah `PUT /settings`, yang admin-only di Rust;
          `/ppob/settings` terdaftar di `ADMIN_ONLY_PREFIXES` supaya guard yang
          sama dengan `/settings` yang menjaganya. */}
      <Route element={<AdminRouteGuard />}>
        <Route path="settings" element={<PpobSettings />} />
      </Route>
      {/* `ppob/*` sudah cocok di router induk, jadi alamat yang tidak dikenal di
          sini tidak sampai ke catch-all 404-nya. Yang paling mungkin nyasar:
          `/ppob/history` yang tersimpan sebagai rute resume dari versi lama. */}
      <Route path="*" element={<Navigate to="/ppob" replace />} />
    </Routes>
  )
}

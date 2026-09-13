import { Navigate, Routes, Route } from "react-router-dom"

import { AdminRouteGuard } from "@/app/app-guard"
import { PulsaFlow } from "./pulsa-flow"
import { DataFlow } from "./data-flow"
import { PlnFlow } from "./pln-flow"
import { PdamFlow } from "./pdam-flow"
import { BpjsFlow } from "./bpjs-flow"
import { PpFlow } from "./pp-flow"
import { TransferFlow } from "./transfer-flow"
import { EmoneyFlow } from "./emoney-flow"
import { VoucherFlow } from "./voucher-flow"
import { PpobHome } from "./ppob-home"
import { PpobMutasi } from "./mutasi"
import { PpobNotifications } from "./notifications"
import { PpobSettings } from "./settings"

export function PpobPage() {
  return (
    <Routes>
      <Route index element={<PpobHome />} />
      <Route path="pulsa" element={<PulsaFlow />} />
      <Route path="data" element={<DataFlow />} />
      <Route path="pln" element={<PlnFlow />} />
      <Route path="pdam" element={<PdamFlow />} />
      <Route path="bpjs" element={<BpjsFlow />} />
      <Route path="pp" element={<PpFlow />} />
      <Route path="transfer" element={<TransferFlow />} />
      <Route path="emoney" element={<EmoneyFlow />} />
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

# E2E Test Plan — Kasir POS

Scope: drive the real Tauri app (webview + embedded axum API + SQLite) end to end.
Business rules come from `CLAUDE.md`; each flow below is one spec, given/when/then.

## Critical flows (automate first, in this order)

1. **Onboarding** — Given an empty `KASIR_DATA_DIR`, when the user enters store name/address/phone
   and creates the first admin, then `store_info` is saved and the login screen appears.
2. **Login** — Given an active `kasir` user, when they enter username + a correct 4-6 digit PIN,
   then the cashier screen opens; a wrong PIN shows an error and no session cookie is set.
3. **Cashier sale, barcode + cash change** — Given a product with EAN-13 and stock 10, when the
   barcode is scanned twice (qty becomes 2, not two rows) and paid cash above the total, then the change
   is shown, receipt `TRX-YYYYMMDD-XXXX` is created and stock drops to 8.
4. **Refund within 7 days** — Given a sale 6 days old, when one item is refunded as `good`, then
   the refund amount is calculated, stock returns and status is `partial_refund`; the same flow at
   8 days is rejected. A `damaged`/`expired` item creates a write-off linked by `refund_id`.
5. **Exchange difference** — Given a sale, when a cheaper item is swapped for a pricier one, then
   `difference_amount = refund - exchange` is negative and the customer pays; the reverse case shows a
   positive refund to the customer; a same-item swap gives a difference of 0.
6. **Write-off rules per role** — Given a `kasir` session, when a `damaged`/`expired` write-off is
   submitted, then it is approved with `loss_value = buy_price x qty`; `lost` is refused for kasir
   (403 / option hidden) and allowed for admin.
7. **PPOB purchase with ADVICE** — Given the mocked Mitra API answers the purchase as pending, when
   the cashier buys a product on `/ppob/*`, then the app sends ADVICE until it gets a final status,
   records one `channel = ppob` transaction (idempotent on retry) and stays on the PPOB page; that
   transaction is not counted in the sales report.
8. **Receipt print path (fake printer)** — Given a USB printer configured to a fake device, when a
   sale completes and "Cetak" is pressed, then ESC/POS bytes reach the device: init, store header,
   items, total, change, receipt number, cut. Assert on the captured bytes.
9. **Shift close** — Given an open shift with cash and QRIS sales plus one cash refund, when the
   cashier closes the shift with a counted cash amount, then expected cash, the variance and the
   per-method totals are correct, and a new sale needs a new shift.
10. **Updater banner** — Given a mock `latest.json` that offers a newer version, when the user
    presses "Periksa pembaruan" (debug builds never auto-check), then the banner shows the version;
    a same-version manifest shows "up to date". Do not run the install step in E2E.

## Running against the real Tauri app on Linux

- **Driver:** `cargo install tauri-driver`, plus WebKitWebDriver (`webkit2gtk-driver` on
  Debian/Ubuntu). Build a debug binary (`bun run tauri build --debug`) and point WebdriverIO
  (or selenium) at `http://127.0.0.1:4444` with `tauri:options.application` = the binary path.
  Run `tauri-driver` with `--native-driver $(which WebKitWebDriver)`. Under headless CI, wrap it in `xvfb-run`.
- **Isolation per run:** a throwaway temp dir:
  `export KASIR_DATA_DIR=$T/data XDG_CONFIG_HOME=$T/cfg XDG_DATA_HOME=$T/share XDG_CACHE_HOME=$T/cache`.
  Use `KASIR_PORT=0` or a free port. Delete `$T` afterwards. Never touch the real profile.
- **Seeding:** do onboarding through the UI once (flow 1), then seed products/users through the
  HTTP API with the session cookie + CSRF token, so later specs start fast and deterministic.
  For the 7-day refund boundary, backdate `transactions.created_at` in the temp SQLite file.
- **Mocked Mitra API:** run a small local HTTP stub (e.g. a Bun server) with scripted
  auth / inquiry / purchase / ADVICE responses: pending -> success, pending -> failed, timeout.
  Prerequisite: `services/ppob/client.rs` hardcodes `BASE_URL`; add a debug-only env override
  (e.g. `KASIR_MITRA_BASE_URL`) before these specs can run.
- **Fake `/dev/usb` printer:** E2E must not need root or real `/dev/usb/lp0`. Either
  (a) `mkfifo $T/lp0` and `cat $T/lp0 > $T/printed.bin` in the background, or
  (b) `socat -d pty,raw,echo=0,link=$T/lp0 OPEN:$T/printed.bin,creat` for a pty.
  Then configure the printer device path to `$T/lp0` in Pengaturan (or via the API) and assert on
  `printed.bin` (e.g. starts with `ESC @`, contains the receipt number, ends with `GS V`).
- **Updater mock:** serve a `latest.json` from the same stub. This needs a debug-only override of
  the endpoint in `tauri.conf.json` / `updater/`, as for Mitra.
- **Hygiene:** one fresh app process per spec file; collect `$KASIR_DATA_DIR` logs and a
  screenshot on failure; time assertions use a fixed timezone (`TZ=Asia/Jakarta`).

import { expect, test, type Page } from "@playwright/test"

/** Mock the backend: `needsOnboarding` drives GET /api/onboarding/status; no session. */
async function mockApi(page: Page, needsOnboarding: boolean): Promise<void> {
  // Predicate, not "**/api/**": that glob would also swallow Vite modules under /src/lib/api/.
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const { pathname } = new URL(route.request().url())
    const method = route.request().method()

    if (method === "GET" && pathname === "/api/onboarding/status") {
      return route.fulfill({ status: 200, json: needsOnboarding })
    }
    if (method === "GET" && pathname === "/api/auth/me") {
      return route.fulfill({ status: 401, json: { code: "unauthorized", message: "Unauthorized" } })
    }
    return route.fulfill({ status: 404, json: { code: "not_found", message: "Not mocked" } })
  })
}

test("shows the login screen when onboarding is done and there is no session", async ({ page }) => {
  await mockApi(page, false)
  await page.goto("/")
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByText("Masuk ke POS")).toBeVisible()
})

test("redirects to onboarding on first run", async ({ page }) => {
  await mockApi(page, true)
  await page.goto("/")
  await expect(page).toHaveURL(/\/onboarding/)
  await expect(page.locator("body")).not.toContainText("Masuk ke POS")
})

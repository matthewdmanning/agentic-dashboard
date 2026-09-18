import { test } from "@playwright/test";

test("take dashboard screenshot", async ({ page }) => {
  await page.goto("http://localhost:5176/");
  await page.waitForSelector("text=Reading Queue", { timeout: 10000 });
  await page.screenshot({ path: "dashboard-screenshot.png" });
  console.log("Screenshot saved!");
});

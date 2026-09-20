import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto("http://localhost:5176/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);

const screenshotPath = "dashboard-screenshot.png";
await page.screenshot({ path: screenshotPath, fullPage: false });
console.log("✓ Screenshot saved to:", screenshotPath);

await browser.close();

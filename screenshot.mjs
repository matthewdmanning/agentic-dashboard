import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });

// Wait for tiles to render
await page.waitForTimeout(1000);

const dir = 'docs/test-drives/2026-09-17_active-projects-tile';
await page.screenshot({ path: `${dir}/screenshots/dashboard.png`, fullPage: true });

console.log('Screenshot saved');
await browser.close();

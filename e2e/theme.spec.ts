import { expect, test, type Page } from "@playwright/test";

/**
 * Dark mode is reachable two ways and both have broken before: the palette
 * exists in `styles.css` but nothing ever set `.dark`, so the tokens were
 * dead code. These check the class actually lands, that an explicit choice
 * survives a reload, and that with no choice stored the OS decides.
 */

const toggle = (page: Page) => page.getByRole("button", { name: /theme/i });
const isDark = (page: Page) =>
  page.evaluate(() => document.documentElement.classList.contains("dark"));

test.describe("theme toggle", () => {
  test("toggles the palette and remembers the choice", async ({ page }) => {
    await page.goto("/");
    await expect(toggle(page)).toBeVisible();
    expect(await isDark(page)).toBe(false);

    await toggle(page).click();
    expect(await isDark(page)).toBe(true);
    await page.screenshot({
      path: "screenshots/theme-dark.png",
      fullPage: true,
    });

    await page.reload();
    expect(await isDark(page)).toBe(true);

    await toggle(page).click();
    expect(await isDark(page)).toBe(false);
    await page.reload();
    expect(await isDark(page)).toBe(false);
    await page.screenshot({
      path: "screenshots/theme-light.png",
      fullPage: true,
    });
  });

  test("follows the OS when nothing has been chosen", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto("/");
    expect(await isDark(page)).toBe(true);
    await context.close();
  });
});

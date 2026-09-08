import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { E2E_WORKSPACE } from "../playwright.config";

/**
 * The one thing only a browser can check (D35): the token travels in the URL
 * the server printed, the page keeps it per tab, and the address bar no longer
 * carries it. A caller without it is not the local user, however local it is.
 */
async function localUserToken(): Promise<string> {
  return (
    await readFile(`${E2E_WORKSPACE}/.dashboard/local-user-token`, "utf8")
  ).trim();
}

test("a token in the URL loads the dashboard, then leaves the address bar", async ({
  page,
}) => {
  await page.goto(`/?token=${await localUserToken()}`);

  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
  await expect(page.getByRole("alert")).toBeHidden();

  expect(new URL(page.url()).searchParams.has("token")).toBe(false);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("dashboard.localUserToken"),
    ),
  ).toBe(await localUserToken());
});

test("reaching the port without the token proves nothing", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("alert")).toHaveText("Permission denied: read");
});

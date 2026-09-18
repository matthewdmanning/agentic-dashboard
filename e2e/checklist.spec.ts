import { expect, test } from "@playwright/test";
import { waitForRegistryReady } from "./support/registry";

test("renders the Reading queue as an interactive checklist", async ({
  page,
}) => {
  await waitForRegistryReady();
  await page.goto("/");

  const tile = page.locator('[data-tile-id="reading-queue"]');
  const checkboxes = tile.getByRole("checkbox");

  await expect(tile).toContainText("Reading queue");
  await expect(checkboxes).toHaveCount(3);
  await expect(checkboxes.nth(0)).not.toBeChecked();

  await checkboxes.nth(0).check();
  await expect(checkboxes.nth(0)).toBeChecked();
});

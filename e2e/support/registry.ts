import { E2E_CONFIG, E2E_ORIGIN } from "../../playwright.config";

/**
 * The dev server can legitimately 404 `/r/registry.json` for a moment after
 * boot — poll instead of a bare `page.goto`, which
 * a webServer health check on a different path does not rule out.
 */
export async function waitForRegistryReady(): Promise<void> {
  const url = `${E2E_ORIGIN}/r/registry.json`;
  const deadline = Date.now() + E2E_CONFIG.tests.registryWaitTimeout;
  for (;;) {
    const response = await fetch(url);
    if (response.ok) return;
    if (Date.now() > deadline)
      throw new Error(`GET ${url} failed: ${response.status}`);
    await new Promise((resolve) =>
      setTimeout(resolve, E2E_CONFIG.tests.registryPollInterval),
    );
  }
}

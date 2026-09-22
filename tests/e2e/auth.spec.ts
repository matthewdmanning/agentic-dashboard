import { expect, test } from "@playwright/test";

import { connectMcpClient, type McpTestClient } from "./support/mcp-client";
import { E2E_WORKSPACE } from "../../playwright.config";

/**
 * The MCP boundary's half of "no credential, no access" (#133): a caller
 * presenting nothing, or something not on the whitelist, is refused on both
 * tools. `src/auth/whitelist.test.ts` already covers `resolveAccount` as a
 * pure function — it says nothing about whether the server actually asks.
 * Only a real connection can, so this drives the same stdio server an agent
 * connects to.
 *
 * Mutates nothing: every call under test is refused before the dashboard is
 * read or written, so this spec is safe alongside any other.
 */
const DENIED_CALLERS = [
  { label: "a credential that is not on the whitelist", credential: "nope" },
  { label: "no credential at all", credential: "" },
] as const;

for (const { label, credential } of DENIED_CALLERS) {
  test.describe(`a caller presenting ${label}`, () => {
    let client: McpTestClient;

    test.beforeAll(async () => {
      client = await connectMcpClient(E2E_WORKSPACE, credential);
    });

    test.afterAll(async () => {
      await client.close();
    });

    test("is refused by read-dashboard", async () => {
      const result = await client.callToolRaw("read-dashboard");

      expect(
        result.isError,
        "read-dashboard must refuse an unresolved caller, not return the dashboard",
      ).toBe(true);
      expect(result.structuredContent).toBeUndefined();
    });

    test("is refused by apply, reported as unauthenticated", async () => {
      const result = await client.callToolRaw("apply", {
        mutations: [
          {
            type: "add-tile",
            tile: {
              id: "auth-denied-tile",
              title: "Should Never Exist",
              item: "stat-tile",
              state: { LABEL: "Denied", VALUE: 1 },
            },
            size: "sm",
          },
        ],
      });

      expect(result.isError).toBe(true);
      // The interface's own failure name, never prose to pattern-match.
      expect(result.structuredContent).toMatchObject({
        status: "error",
        failure: "unauthenticated",
      });
    });
  });
}

test("a whitelisted caller is still served, so the refusals above are not a blanket outage", async () => {
  const client = await connectMcpClient(E2E_WORKSPACE);
  try {
    const result = await client.callToolRaw("read-dashboard");
    expect(result.isError).toBeFalsy();
  } finally {
    await client.close();
  }
});

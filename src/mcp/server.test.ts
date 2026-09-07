import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  defaultDashboardConfiguration,
  type DashboardConfiguration,
  type Role,
} from "../contract";
import {
  createService,
  type DashboardPersistence,
  type DashboardService,
} from "../service";
import type { ConnectionStore } from "../server/integrations/connections";
import { createDashboardMcpServer } from "./server";

function createMemoryPersistence(
  initial: DashboardConfiguration,
): DashboardPersistence {
  let configuration = structuredClone(initial);
  return {
    read: async () => structuredClone(configuration),
    write: async (next) => {
      configuration = structuredClone(next);
    },
  };
}

/** Keyed by user and catalog entry (D40, #88); MCP runs as the local user, so tests key by that username. */
function createMemoryConnectionStore(): ConnectionStore {
  const values = new Map<string, string>();
  const key = (user: string, catalogEntryId: string) =>
    `${user} ${catalogEntryId}`;
  return {
    get: async (user, catalogEntryId) => values.get(key(user, catalogEntryId)),
    set: async (user, catalogEntryId, credential) => {
      values.set(key(user, catalogEntryId), credential);
    },
    remove: async (user, catalogEntryId) => {
      values.delete(key(user, catalogEntryId));
    },
    removeAllForEntry: async (catalogEntryId) => {
      for (const existingKey of [...values.keys()]) {
        if (existingKey.endsWith(` ${catalogEntryId}`))
          values.delete(existingKey);
      }
    },
    countForEntry: async (catalogEntryId) => {
      return [...values.keys()].filter((existingKey) =>
        existingKey.endsWith(` ${catalogEntryId}`),
      ).length;
    },
  };
}

function createTestService(
  initial: DashboardConfiguration = defaultDashboardConfiguration,
  extra: {
    connections?: ConnectionStore;
    connectableTypes?: string[];
    localUser?: Role;
    cardTemplateManifestPath?: string;
    cardTemplateClientBuildPath?: string;
  } = {},
): DashboardService {
  return createService({
    persistence: createMemoryPersistence(initial),
    ...extra,
  });
}

/** Isolates a test's promoted manifest/client build from every other test's, and from the workspace default. Seeded empty, not absent, so it never falls back to the compiled default's fixture templates. */
async function temporaryCardTemplatePaths() {
  const dir = await mkdtemp(join(tmpdir(), "mcp-card-template-"));
  const cardTemplateManifestPath = join(dir, "manifest.json");
  await writeFile(cardTemplateManifestPath, "{}\n");
  return {
    cardTemplateManifestPath,
    cardTemplateClientBuildPath: join(dir, "client-build.json"),
  };
}

/**
 * Connects a real MCP client to the server over an in-memory transport pair
 * — the module's own interface, the same way `src/server/index.test.ts`
 * drives the HTTP adapter through `Request`/`Response`.
 */
async function connectClient(service: DashboardService): Promise<Client> {
  const server = createDashboardMcpServer(service);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const [block] = result.content;
  if (!block || block.type !== "text") throw new Error("Expected text content");
  return block.text;
}

describe("dashboard MCP server", () => {
  test("exposes a tool per mutation constructor plus reading the dashboard", async () => {
    const client = await connectClient(createTestService());

    const { tools } = await client.listTools();

    expect(new Set(tools.map((tool) => tool.name))).toEqual(
      new Set([
        "read-dashboard",
        "add-card",
        "edit-card",
        "remove-card",
        "patch-card-state",
        "insert-card",
        "assemble-card-template",
        "edit-dashboard",
        "add-theme",
        "edit-theme",
        "remove-theme",
        "set-font-scale",
        "add-integration",
        "edit-integration",
        "remove-integration",
        "block-integration",
        "unblock-integration",
        "set-integration-retention-policy",
        "connect-integration",
        "disconnect-integration",
        "read-appearance",
        "set-base-colour",
      ]),
    );
  });

  test("reads dashboard state through the service", async () => {
    const client = await connectClient(createTestService());

    const result = await client.callTool({
      name: "read-dashboard",
      arguments: { scope: "presentation" },
    });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toMatchObject({
      dashboard: defaultDashboardConfiguration.dashboard,
    });
  });

  test("applies a mutation through the service", async () => {
    const client = await connectClient(createTestService());

    const applied = await client.callTool({
      name: "set-font-scale",
      arguments: { fontScale: 1.25 },
    });
    expect(applied.isError).toBeFalsy();

    const read = await client.callTool({
      name: "read-dashboard",
      arguments: { scope: "presentation" },
    });
    expect(JSON.parse(text(read))).toMatchObject({ fontScale: 1.25 });
  });

  test("a denied read surfaces as an MCP error carrying the service's failure code", async () => {
    // This caller's role has `roles: noAccess`.
    const client = await connectClient(
      createTestService(defaultDashboardConfiguration, {
        localUser: {
          name: "localUser",
          permissions: {
            data: "write",
            cards: "write",
            presentation: "write",
            integrations: "write",
            roles: "noAccess",
          },
        },
      }),
    );

    const result = await client.callTool({
      name: "read-dashboard",
      arguments: { scope: "roles" },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "permission-denied",
    });
  });

  test("a denied apply surfaces as an MCP error carrying the service's failure code", async () => {
    const client = await connectClient(
      createTestService(defaultDashboardConfiguration, {
        localUser: {
          name: "localUser",
          permissions: {
            data: "read",
            cards: "read",
            presentation: "read",
            integrations: "read",
            roles: "noAccess",
          },
        },
      }),
    );

    const result = await client.callTool({
      name: "set-font-scale",
      arguments: { fontScale: 1.5 },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "permission-denied",
    });
  });

  test("assembles a card template from a name, a JSON Schema, and a composition tree", async () => {
    const templatePath = join(
      process.cwd(),
      "src",
      "client",
      "cards",
      "__mcp-test-assembled.tsx",
    );
    const client = await connectClient(
      createTestService(defaultDashboardConfiguration, {
        ...(await temporaryCardTemplatePaths()),
      }),
    );

    try {
      const result = await client.callTool({
        name: "assemble-card-template",
        arguments: {
          template: "__mcp-test-assembled",
          jsonSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          composition: { component: "Badge", props: {}, children: [] },
        },
      });

      expect(result.isError).toBeFalsy();
      const source = await readFile(templatePath, "utf8");
      expect(source).toContain('import { Badge } from "@/components/ui/badge"');
    } finally {
      await unlink(templatePath).catch(() => undefined);
    }
  });

  test("an invalid composition tree surfaces the service's failure code", async () => {
    const client = await connectClient(
      createTestService(defaultDashboardConfiguration, {
        ...(await temporaryCardTemplatePaths()),
      }),
    );

    const result = await client.callTool({
      name: "assemble-card-template",
      arguments: {
        template: "__mcp-test-invalid",
        jsonSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        composition: {
          component: "NotARealComponent",
          props: {},
          children: [],
        },
      },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "invalid-card-template",
    });
  });

  test("an unknown-id failure surfaces its own code, not a permission denial", async () => {
    const client = await connectClient(createTestService());

    const result = await client.callTool({
      name: "edit-theme",
      arguments: { theme: { id: "absent", settings: {} } },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "unknown-id" });
  });
});

describe("integration connections through MCP", () => {
  const localUsername = userInfo().username;

  test("connects an account through the same enforcement point as the HTTP adapter", async () => {
    const connections = createMemoryConnectionStore();
    const client = await connectClient(
      createTestService(
        {
          ...defaultDashboardConfiguration,
          integrations: [
            { id: "team-calendar", type: "google-calendar", settings: {} },
          ],
        },
        { connections },
      ),
    );

    const result = await client.callTool({
      name: "connect-integration",
      arguments: { integrationId: "team-calendar", credential: "secret-token" },
    });

    expect(result.isError).toBeFalsy();
    await expect(connections.get(localUsername, "team-calendar")).resolves.toBe(
      "secret-token",
    );
  });

  test("a role with no integrations access still connects, unlike a real permission-gated mutation (D35)", async () => {
    const connections = createMemoryConnectionStore();
    const client = await connectClient(
      createTestService(
        {
          ...defaultDashboardConfiguration,
          integrations: [
            { id: "team-calendar", type: "google-calendar", settings: {} },
          ],
        },
        {
          connections,
          localUser: {
            name: "localUser",
            permissions: {
              data: "write",
              cards: "write",
              presentation: "write",
              integrations: "noAccess",
              roles: "noAccess",
            },
          },
        },
      ),
    );

    const result = await client.callTool({
      name: "connect-integration",
      arguments: { integrationId: "team-calendar", credential: "secret-token" },
    });

    expect(result.isError).toBeFalsy();
    await expect(connections.get(localUsername, "team-calendar")).resolves.toBe(
      "secret-token",
    );
  });

  test("disconnecting through MCP leaves no credential behind, and leaves the integration in place", async () => {
    const connections = createMemoryConnectionStore();
    await connections.set(localUsername, "team-calendar", "secret-token");
    const client = await connectClient(
      createTestService(
        {
          ...defaultDashboardConfiguration,
          integrations: [
            { id: "team-calendar", type: "google-calendar", settings: {} },
          ],
        },
        { connections },
      ),
    );

    const result = await client.callTool({
      name: "disconnect-integration",
      arguments: { integrationId: "team-calendar" },
    });

    expect(result.isError).toBeFalsy();
    await expect(
      connections.get(localUsername, "team-calendar"),
    ).resolves.toBeUndefined();
  });
});

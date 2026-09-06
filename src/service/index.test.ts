import { describe, expect, test } from "vitest";
import { userInfo } from "node:os";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

import {
  defaultDashboardConfiguration,
  roles,
  type DashboardConfiguration,
  type Mutation,
  type Role,
} from "../contract";
import type { CredentialStore } from "../server/integrations/credentials";
import {
  createService,
  resolveCaller,
  type DashboardPersistence,
} from "./index";
import {
  useTestCardTemplates,
  withTestCard,
} from "../test-support/card-template";

useTestCardTemplates();

/** The default configuration is cardless since D32; these tests need a card. */
const testConfiguration = withTestCard(defaultDashboardConfiguration);

function createMemoryCredentialStore(): CredentialStore {
  const values = new Map<string, string>();
  return {
    get: async (id) => values.get(id),
    set: async (id, credential) => {
      values.set(id, credential);
    },
    remove: async (id) => {
      values.delete(id);
    },
  };
}

function createMemoryPersistence(
  initial = testConfiguration,
): DashboardPersistence & {
  writes: DashboardConfiguration[];
} {
  let configuration = structuredClone(initial);
  const writes: DashboardConfiguration[] = [];

  return {
    writes,
    read: async () => structuredClone(configuration),
    write: async (next) => {
      configuration = structuredClone(next);
      writes.push(structuredClone(next));
    },
  };
}

function withLocalPermissions(permissions: Role["permissions"]): Role {
  return { name: "localUser", permissions };
}

describe("dashboard service", () => {
  test("reads the requested state when the caller has read access", async () => {
    const persistence = createMemoryPersistence();
    const service = createService({ persistence });

    await expect(service.read("cards")).resolves.toEqual(
      testConfiguration.cards,
    );
  });

  test("applies authorized mutations atomically", async () => {
    const persistence = createMemoryPersistence();
    const service = createService({ persistence });
    const mutations: Mutation[] = [
      {
        type: "patch-card-state",
        cardId: "welcome",
        patch: { message: "Updated" },
      },
      {
        type: "set-font-scale",
        fontScale: 1.25,
      },
    ];

    await expect(service.apply(mutations)).resolves.toMatchObject({
      fontScale: 1.25,
      cards: [{ state: { message: "Updated" } }],
    });
    expect(persistence.writes).toHaveLength(1);
  });

  test("never leaks a category the caller may not read back through apply", async () => {
    const persistence = createMemoryPersistence();
    const service = createService({
      persistence,
      localUser: withLocalPermissions({
        data: "write",
        cards: "write",
        presentation: "write",
        integrations: "write",
        roles: "noAccess",
      }),
    });

    const result = await service.apply([
      { type: "set-font-scale", fontScale: 1.5 },
    ]);

    expect(result).not.toHaveProperty("roles");
  });

  test("a caller who may change what it cannot otherwise read still gets an answer, not a throw", async () => {
    // `data: edit` alone lets a caller patch card state; every other category
    // is `noAccess`. Reading `cards` piggybacks on `data` (see the ponytail note
    // by `projectReadable`), so this projection is not literally empty — but
    // it must resolve, not throw `permission-denied`, the way a bare
    // `read("all")` would for a role that may read nothing at all.
    const persistence = createMemoryPersistence();
    const service = createService({
      persistence,
      localUser: withLocalPermissions({
        data: "edit",
        cards: "noAccess",
        presentation: "noAccess",
        integrations: "noAccess",
        roles: "noAccess",
      }),
    });

    const result = await service.apply([
      {
        type: "patch-card-state",
        cardId: "welcome",
        patch: { message: "Updated" },
      },
    ]);

    expect(result).toMatchObject({
      cards: [{ state: { message: "Updated" } }],
    });
    expect(result).not.toHaveProperty("dashboard");
    expect(result).not.toHaveProperty("integrations");
    expect(result).not.toHaveProperty("roles");
  });

  test("rejects an unauthorized mutation without persisting any mutation", async () => {
    const persistence = createMemoryPersistence();
    const service = createService({
      persistence,
      localUser: withLocalPermissions({
        data: "write",
        cards: "write",
        presentation: "noAccess",
        integrations: "write",
        roles: "noAccess",
      }),
    });

    await expect(
      service.apply([
        {
          type: "patch-card-state",
          cardId: "welcome",
          patch: { message: "Updated" },
        },
        {
          type: "set-font-scale",
          fontScale: 1.25,
        },
      ]),
    ).rejects.toThrow("presentation: edit");
    expect(persistence.writes).toHaveLength(0);
  });

  test("lets an edit-level role change what exists but not create or destroy", async () => {
    const persistence = createMemoryPersistence();
    const service = createService({
      persistence,
      localUser: withLocalPermissions({
        data: "edit",
        cards: "edit",
        presentation: "edit",
        integrations: "edit",
        roles: "noAccess",
      }),
    });

    await expect(
      service.apply([
        {
          type: "patch-card-state",
          cardId: "welcome",
          patch: { message: "Updated" },
        },
      ]),
    ).resolves.toMatchObject({ cards: [{ state: { message: "Updated" } }] });

    await expect(
      service.apply([
        {
          type: "add-theme",
          theme: { id: "dark", settings: {} },
        },
      ]),
    ).rejects.toThrow("presentation: write");
  });

  test("resolves credentialed callers before checking their role", async () => {
    const persistence = createMemoryPersistence();
    const service = createService({
      persistence,
      roles: [
        {
          name: "reader",
          permissions: {
            data: "noAccess",
            cards: "read",
            presentation: "noAccess",
            integrations: "noAccess",
            roles: "noAccess",
          },
        },
      ],
      authStore: {
        resolve: async (credential) => {
          expect(credential).toBe("credential");
          return { user: "test-user", role: "reader" };
        },
      },
    });

    await expect(service.read("cards", "credential")).resolves.toEqual(
      testConfiguration.cards,
    );
  });

  test("keeps the authenticated account user with its resolved role", async () => {
    await expect(
      resolveCaller(
        {
          authStore: {
            resolve: async () => ({ user: "alice", role: "reader" }),
          },
          roles: [
            {
              name: "reader",
              permissions: {
                data: "noAccess",
                cards: "read",
                presentation: "noAccess",
                integrations: "noAccess",
                roles: "noAccess",
              },
            },
          ],
          persistence: createMemoryPersistence(),
        },
        "credential",
      ),
    ).resolves.toMatchObject({ user: "alice", role: { name: "reader" } });
  });

  test("resolves the local caller to the running OS account", async () => {
    await expect(
      resolveCaller(
        { localUserToken: "secret", persistence: createMemoryPersistence() },
        "secret",
      ),
    ).resolves.toMatchObject({ user: userInfo().username });
  });

  test("read('all') returns only the categories the role may read", async () => {
    const service = createService({ persistence: createMemoryPersistence() });

    await expect(service.read("all")).resolves.toEqual({
      cards: testConfiguration.cards,
      dashboard: testConfiguration.dashboard,
      themes: testConfiguration.themes,
      fontScale: testConfiguration.fontScale,
      integrations: testConfiguration.integrations,
      roles,
    });
  });

  test("tells a caller its own role however narrow that role is", async () => {
    const persistence = createMemoryPersistence();
    const service = createService({
      persistence,
      localUser: withLocalPermissions({
        data: "noAccess",
        cards: "noAccess",
        presentation: "noAccess",
        integrations: "noAccess",
        roles: "noAccess",
      }),
    });

    await expect(service.read("role")).resolves.toMatchObject({
      name: "localUser",
      permissions: { roles: "noAccess" },
    });
  });

  test("refuses a scoped read the role has no access to", async () => {
    const service = createService({
      persistence: createMemoryPersistence(),
      localUser: withLocalPermissions({
        data: "write",
        cards: "write",
        presentation: "write",
        integrations: "write",
        roles: "noAccess",
      }),
    });

    await expect(service.read("roles")).rejects.toThrow("roles: read");
  });

  test("serves the roles file, not dashboard configuration", async () => {
    const persistence = createMemoryPersistence();
    const service = createService({ persistence });

    await expect(service.read("roles")).resolves.toEqual(roles);
    await service.apply([{ type: "set-font-scale", fontScale: 1.5 }]);
    expect(persistence.writes[0]).not.toHaveProperty("roles");
  });

  test("requires presentation write to remove a card a dashboard holds", async () => {
    const persistence = createMemoryPersistence();
    const service = createService({
      persistence,
      localUser: withLocalPermissions({
        data: "write",
        cards: "write",
        presentation: "noAccess",
        integrations: "write",
        roles: "noAccess",
      }),
    });

    await expect(
      service.apply([{ type: "remove-card", cardId: "welcome" }]),
    ).rejects.toThrow("presentation: write");
    expect(persistence.writes).toHaveLength(0);
  });

  test("removing a placed card closes the hole it left in the dashboard", async () => {
    const service = createService({ persistence: createMemoryPersistence() });

    await expect(
      service.apply([{ type: "remove-card", cardId: "welcome" }]),
    ).resolves.toMatchObject({ cards: [], dashboard: { cards: [] } });
  });

  test("creates a theme and refuses to add one twice", async () => {
    const service = createService({ persistence: createMemoryPersistence() });

    await expect(
      service.apply([
        {
          type: "add-theme",
          theme: { id: "dark", settings: { density: "compact" } },
        },
      ]),
    ).resolves.toMatchObject({ themes: [{ id: "calm" }, { id: "dark" }] });

    await expect(
      service.apply([
        {
          type: "add-theme",
          theme: { id: "calm", settings: {} },
        },
      ]),
    ).rejects.toThrow("Duplicate theme: calm");
  });

  test("creates an integration a card can then query", async () => {
    const service = createService({ persistence: createMemoryPersistence() });

    await expect(
      service.apply([
        {
          type: "add-integration",
          integration: {
            id: "calendar",
            type: "google-calendar",
            settings: { calendarId: "team" },
          },
        },
      ]),
    ).resolves.toMatchObject({ integrations: [{ id: "calendar" }] });
  });

  test("edit mutations refuse to create what they cannot find", async () => {
    const service = createService({ persistence: createMemoryPersistence() });

    await expect(
      service.apply([
        {
          type: "edit-theme",
          theme: { id: "missing", settings: {} },
        },
      ]),
    ).rejects.toThrow("Unknown theme: missing");
  });

  test("refuses to remove a theme a dashboard still names", async () => {
    const service = createService({ persistence: createMemoryPersistence() });

    await expect(
      service.apply([{ type: "remove-theme", themeId: "calm" }]),
    ).rejects.toThrow("because dashboard 'home' uses it");
  });
});

describe("card template assembly", () => {
  const templatePath = join(
    process.cwd(),
    "src",
    "client",
    "cards",
    "__test-assembled.tsx",
  );

  test("assembles a valid composition tree into tracked source", async () => {
    const service = createService({ persistence: createMemoryPersistence() });

    try {
      await expect(
        service.apply([
          {
            type: "assemble-card-template",
            template: "__test-assembled",
            composition: { component: "Text", props: {}, children: [] },
          },
        ]),
      ).resolves.toBeDefined();

      const source = await readFile(templatePath, "utf8");
      expect(source).toContain(
        'import { Text } from "react-aria-components"',
      );
    } finally {
      await unlink(templatePath).catch(() => undefined);
    }
  });

  test("fails before writing when the tree does not type-check", async () => {
    const service = createService({ persistence: createMemoryPersistence() });

    await expect(
      service.apply([
        {
          type: "assemble-card-template",
          template: "__test-assembled",
          composition: {
            component: "NotARealComponent",
            props: {},
            children: [],
          },
        },
      ]),
    ).rejects.toThrow("failed to type-check");

    await expect(readFile(templatePath, "utf8")).rejects.toThrow();
  });

  test("fails a real component given a wrong prop type, not just an unknown one", async () => {
    // Unlike the unknown-component case above (which fails on the import
    // line before JSX is even checked), this proves the scoped tsconfig
    // still runs full prop typechecking against react-aria-components' real
    // types — the whole point of dropping the per-component registry (D22).
    const service = createService({ persistence: createMemoryPersistence() });

    await expect(
      service.apply([
        {
          type: "assemble-card-template",
          template: "__test-assembled",
          composition: {
            component: "Heading",
            props: { level: "two" },
            children: [],
          },
        },
      ]),
    ).rejects.toThrow("failed to type-check");

    await expect(readFile(templatePath, "utf8")).rejects.toThrow();
  });
});

describe("integration authorization", () => {
  test("stores a connection's credential, gated at integrations: edit", async () => {
    const credentials = createMemoryCredentialStore();
    const service = createService({
      persistence: createMemoryPersistence({
        ...testConfiguration,
        integrations: [
          { id: "team-calendar", type: "google-calendar", settings: {} },
        ],
      }),
      credentials,
    });

    await service.authorize("team-calendar", "secret-token");

    await expect(credentials.get("team-calendar")).resolves.toBe(
      "secret-token",
    );
  });

  test("refuses to store a credential for an integration that does not exist", async () => {
    const credentials = createMemoryCredentialStore();
    const service = createService({
      persistence: createMemoryPersistence(),
      credentials,
    });

    await expect(service.authorize("invented", "secret-token")).rejects.toThrow(
      "Unknown integration: invented",
    );
    await expect(credentials.get("invented")).resolves.toBeUndefined();
  });

  test("refuses a caller without integrations: edit", async () => {
    const credentials = createMemoryCredentialStore();
    const service = createService({
      persistence: createMemoryPersistence(),
        localUser: withLocalPermissions({
          data: "write",
          cards: "write",
          presentation: "write",
          integrations: "read",
          roles: "noAccess",
        }),
      credentials,
    });

    await expect(
      service.authorize("team-calendar", "secret-token"),
    ).rejects.toThrow("integrations: edit");
    await expect(credentials.get("team-calendar")).resolves.toBeUndefined();
  });

  test("removing an integration drops its stored credential, whichever adapter asked", async () => {
    const credentials = createMemoryCredentialStore();
    await credentials.set("team-calendar", "secret-token");
    const service = createService({
      persistence: createMemoryPersistence({
        ...testConfiguration,
        integrations: [
          { id: "team-calendar", type: "google-calendar", settings: {} },
        ],
      }),
      credentials,
    });

    await service.apply([
      { type: "remove-integration", integrationId: "team-calendar" },
    ]);

    await expect(credentials.get("team-calendar")).resolves.toBeUndefined();
  });

  test("a failed apply leaves the credential in place", async () => {
    const credentials = createMemoryCredentialStore();
    await credentials.set("team-calendar", "secret-token");
    const service = createService({
      persistence: createMemoryPersistence({
        ...testConfiguration,
        integrations: [
          { id: "team-calendar", type: "google-calendar", settings: {} },
        ],
        cards: [
          {
            ...testConfiguration.cards[0]!,
            queries: [
              {
                integration: "team-calendar",
                query: {},
                formatter: { shape: "object", fields: {} },
              },
            ],
          },
        ],
      }),
      credentials,
    });

    await expect(
      service.apply([
        { type: "remove-integration", integrationId: "team-calendar" },
      ]),
    ).rejects.toThrow("because card 'welcome' uses it");
    await expect(credentials.get("team-calendar")).resolves.toBe(
      "secret-token",
    );
  });
});

describe("connectable integration types", () => {
  test("lists the services this build can pull from, gated at integrations: read", async () => {
    const service = createService({
      persistence: createMemoryPersistence(),
      connectableTypes: ["google-calendar"],
    });

    await expect(service.connectableTypes()).resolves.toEqual([
      "google-calendar",
    ]);
  });

  test("refuses a caller with no integrations access", async () => {
    const service = createService({
      persistence: createMemoryPersistence(),
        localUser: withLocalPermissions({
          data: "write",
          cards: "write",
          presentation: "write",
          integrations: "noAccess",
          roles: "noAccess",
        }),
      connectableTypes: ["google-calendar"],
    });

    await expect(service.connectableTypes()).rejects.toThrow(
      "integrations: read",
    );
  });
});

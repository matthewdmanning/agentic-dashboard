import { describe, expect, test, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { tmpdir, userInfo } from "node:os";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  defaultDashboardConfiguration,
  roles,
  type CardMapperSpec,
  type DashboardConfiguration,
  type Mutation,
  type Role,
} from "../contract";
import type { CredentialStore } from "../server/integrations/credentials";
import { createFileIntegrationCatalog } from "../server/integrations/catalog";
import { createSecretBox } from "../server/secret-box";
import {
  createService,
  resolveCaller,
  type DashboardPersistence,
} from "./index";
import { createEncryptedQueryStore, type NewQuery } from "./queries";
import {
  useTestCardTemplates,
  withTestCard,
} from "../test-support/card-template";

// A call-through spy — the real build still runs — so batching can be
// asserted on directly: one `assemble-card-template` batch must reach
// `prepareCardTemplatePromotion` exactly once, not once per mutation (D39).
vi.mock(import("../card-templates/build"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    prepareCardTemplatePromotion: vi.fn(actual.prepareCardTemplatePromotion),
  };
});
import { prepareCardTemplatePromotion } from "../card-templates/build";

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
      cardMappers: testConfiguration.cardMappers,
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
  const validJsonSchema = {
    type: "object",
    properties: {},
    additionalProperties: false,
  };

  // Seeded with an empty active generation rather than left absent: absent
  // would fall back to the compiled default `activeCardTemplateManifest`,
  // which `useTestCardTemplates()` (above) points at fixture components not
  // self-contained enough to survive a real re-typecheck (they import
  // relative to their real tracked location, which a scoped check can't see).
  // These tests are about assembly, not about re-validating fixtures.
  async function temporaryCardTemplatePaths() {
    const dir = await mkdtemp(join(tmpdir(), "assemble-card-template-"));
    const cardTemplateManifestPath = join(dir, "manifest.json");
    await writeFile(cardTemplateManifestPath, "{}\n");
    return {
      cardTemplateManifestPath,
      cardTemplateClientBuildPath: join(dir, "client-build.json"),
    };
  }

  test("assembles a name, JSON Schema, and composition tree into a promoted registry item", async () => {
    const service = createService({
      persistence: createMemoryPersistence(),
      ...(await temporaryCardTemplatePaths()),
    });

    try {
      await expect(
        service.apply([
          {
            type: "assemble-card-template",
            template: "__test-assembled",
            jsonSchema: validJsonSchema,
            composition: { component: "Badge", props: {}, children: [] },
          },
        ]),
      ).resolves.toBeDefined();

      const source = await readFile(templatePath, "utf8");
      expect(source).toContain('import { Badge } from "@/components/ui/badge"');
    } finally {
      await unlink(templatePath).catch(() => undefined);
    }
  });

  test("rejects a missing JSON Schema before anything is built", async () => {
    const service = createService({
      persistence: createMemoryPersistence(),
      ...(await temporaryCardTemplatePaths()),
    });

    await expect(
      service.apply([
        {
          type: "assemble-card-template",
          template: "__test-assembled",
          composition: { component: "Badge", props: {}, children: [] },
        } as unknown as Mutation,
      ]),
    ).rejects.toThrow();

    await expect(readFile(templatePath, "utf8")).rejects.toThrow();
  });

  test("refuses a caller without cards: write", async () => {
    const service = createService({
      persistence: createMemoryPersistence(),
      ...(await temporaryCardTemplatePaths()),
      localUser: withLocalPermissions({
        data: "write",
        cards: "read",
        presentation: "write",
        integrations: "write",
        roles: "noAccess",
      }),
    });

    await expect(
      service.apply([
        {
          type: "assemble-card-template",
          template: "__test-assembled",
          jsonSchema: validJsonSchema,
          composition: { component: "Badge", props: {}, children: [] },
        },
      ]),
    ).rejects.toThrow("cards: write");

    await expect(readFile(templatePath, "utf8")).rejects.toThrow();
  });

  test("fails before promotion when the tree does not type-check", async () => {
    const paths = await temporaryCardTemplatePaths();
    const service = createService({ persistence: createMemoryPersistence(), ...paths });

    await expect(
      service.apply([
        {
          type: "assemble-card-template",
          template: "__test-assembled",
          jsonSchema: validJsonSchema,
          composition: {
            component: "NotARealComponent",
            props: {},
            children: [],
          },
        },
      ]),
    ).rejects.toThrow("failed to build");

    await expect(readFile(templatePath, "utf8")).rejects.toThrow();
    // The prior generation — here, none — stays byte-for-byte active.
    await expect(readFile(paths.cardTemplateManifestPath, "utf8")).resolves.toBe(
      "{}\n",
    );
  });

  test("fails a real component given a wrong prop type, not just an unknown one", async () => {
    // Unlike the unknown-component case above (which fails on the import
    // line before JSX is even checked), this proves the scoped tsconfig
    // still runs full prop typechecking against shadcn/ui's real component
    // types — the whole point of dropping the per-component registry (D22).
    const service = createService({
      persistence: createMemoryPersistence(),
      ...(await temporaryCardTemplatePaths()),
    });

    await expect(
      service.apply([
        {
          type: "assemble-card-template",
          template: "__test-assembled",
          jsonSchema: validJsonSchema,
          composition: {
            component: "Card",
            props: { size: "huge" },
            children: [],
          },
        },
      ]),
    ).rejects.toThrow("failed to build");

    await expect(readFile(templatePath, "utf8")).rejects.toThrow();
  });

  test("fails before promotion when the JSON Schema does not compile", async () => {
    const service = createService({
      persistence: createMemoryPersistence(),
      ...(await temporaryCardTemplatePaths()),
    });

    await expect(
      service.apply([
        {
          type: "assemble-card-template",
          template: "__test-assembled",
          jsonSchema: { type: "not-a-real-type" },
          composition: { component: "Badge", props: {}, children: [] },
        },
      ]),
    ).rejects.toThrow("failed to build");

    await expect(readFile(templatePath, "utf8")).rejects.toThrow();
  });

  test("checks every assemble mutation in a batch with a single build", async () => {
    const service = createService({
      persistence: createMemoryPersistence(),
      ...(await temporaryCardTemplatePaths()),
    });
    const otherTemplatePath = join(
      process.cwd(),
      "src",
      "client",
      "cards",
      "__test-assembled-2.tsx",
    );
    const before = vi.mocked(prepareCardTemplatePromotion).mock.calls.length;

    try {
      await expect(
        service.apply([
          {
            type: "assemble-card-template",
            template: "__test-assembled",
            jsonSchema: validJsonSchema,
            composition: { component: "Badge", props: {}, children: [] },
          },
          {
            type: "assemble-card-template",
            template: "__test-assembled-2",
            jsonSchema: validJsonSchema,
            composition: { component: "Badge", props: {}, children: [] },
          },
        ]),
      ).resolves.toBeDefined();

      expect(vi.mocked(prepareCardTemplatePromotion).mock.calls.length - before).toBe(1);
    } finally {
      await unlink(templatePath).catch(() => undefined);
      await unlink(otherTemplatePath).catch(() => undefined);
    }
  });

  test("a batch failure after a successful type-check discards the assembled template rather than leaving it half-promoted", async () => {
    const paths = await temporaryCardTemplatePaths();
    const service = createService({ persistence: createMemoryPersistence(), ...paths });

    await expect(
      service.apply([
        {
          type: "assemble-card-template",
          template: "__test-assembled",
          jsonSchema: validJsonSchema,
          composition: { component: "Badge", props: {}, children: [] },
        },
        { type: "edit-theme", theme: { id: "definitely-missing", settings: {} } },
      ]),
    ).rejects.toThrow("Unknown theme: definitely-missing");

    // The composition type-checked cleanly — only the later mutation in the
    // same batch failed — so neither half of the promotion may have landed:
    // real filesystem state, not a mock assertion.
    await expect(readFile(templatePath, "utf8")).rejects.toThrow();
    await expect(readFile(paths.cardTemplateManifestPath, "utf8")).resolves.toBe(
      "{}\n",
    );
  });

  test("promotion and tracked source land together or not at all", async () => {
    const paths = await temporaryCardTemplatePaths();
    const service = createService({ persistence: createMemoryPersistence(), ...paths });

    await expect(
      service.apply([
        {
          type: "assemble-card-template",
          template: "__test-assembled",
          jsonSchema: validJsonSchema,
          composition: { component: "Badge", props: {}, children: [] },
        },
      ]),
    ).resolves.toBeDefined();

    try {
      // Both halves of a successful assemble are on disk, not just one:
      // the manifest names the template, and its real source file exists.
      const manifest = JSON.parse(
        await readFile(paths.cardTemplateManifestPath, "utf8"),
      );
      expect(manifest).toHaveProperty("__test-assembled");
      await expect(readFile(templatePath, "utf8")).resolves.toContain(
        'import { Badge } from "@/components/ui/badge"',
      );
    } finally {
      await unlink(templatePath).catch(() => undefined);
    }
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
      }),
      credentials,
    });

    // The batch fails on its second mutation, after `remove-integration`
    // already ran against the in-memory candidate — proving the credential
    // revoke that rides along with a successful removal never fires unless
    // the whole batch, including persistence, actually lands.
    await expect(
      service.apply([
        { type: "remove-integration", integrationId: "team-calendar" },
        {
          type: "edit-theme",
          theme: { id: "definitely-missing", settings: {} },
        },
      ]),
    ).rejects.toThrow("Unknown theme: definitely-missing");
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

describe("file-backed integration catalog", () => {
  async function createCatalog() {
    return createFileIntegrationCatalog(
      join(await mkdtemp(join(tmpdir(), "catalog-")), "catalog.json"),
    );
  }

  test("seeds shared entries visible to every service, including zero connections", async () => {
    const catalog = await createCatalog();
    const persistence = createMemoryPersistence();
    const first = createService({ persistence, catalog });
    const second = createService({ persistence, catalog });

    const entries = await first.read("integrations");
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ origin: "default", state: "available" }),
      expect.objectContaining({ origin: "recommended", state: "available" }),
    ]));
    await expect(second.read("integrations")).resolves.toEqual(entries);
  });

  test("persists a dynamic entry through the existing add-integration seam", async () => {
    const catalog = await createCatalog();
    const service = createService({
      persistence: createMemoryPersistence(),
      catalog,
    });

    await service.apply([{
      type: "add-integration",
      integration: { id: "dynamic-service", type: "dynamic-service", settings: {} },
    }]);

    await expect(catalog.read()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "dynamic-service", origin: "dynamic", state: "available" }),
    ]));
  });

  test("derives connectable choices from available catalog entries", async () => {
    const catalog = await createCatalog();
    const entries = await catalog.read();
    await catalog.write([
      ...entries,
      { id: "blocked-service", type: "blocked-service", settings: {}, origin: "dynamic", state: "blocked" },
    ]);
    const service = createService({ persistence: createMemoryPersistence(), catalog });

    await expect(service.connectableTypes()).resolves.toEqual(["google-calendar"]);
  });
});

describe("user-owned queries", () => {
  async function createQueryStore() {
    const dir = await mkdtemp(join(tmpdir(), "user-queries-"));
    return createEncryptedQueryStore(
      join(dir, "queries.json"),
      createSecretBox(randomBytes(32)),
    );
  }

  const newQuery: NewQuery = {
    cardId: "welcome",
    integration: "calendar",
    query: { calendarId: "team" },
    cardMapper: "identity",
  };

  function twoUserAuthStore() {
    return {
      resolve: async (credential: string) =>
        credential === "alice-token"
          ? { user: "alice", role: "user" }
          : credential === "bob-token"
            ? { user: "bob", role: "user" }
            : credential === "admin-token"
              ? { user: "root", role: "admin" }
              : undefined,
    };
  }

  test("two users supplying queries for the same card each read only their own", async () => {
    const queries = await createQueryStore();
    const service = createService({
      persistence: createMemoryPersistence(),
      queries,
      authStore: twoUserAuthStore(),
    });

    const aliceQuery = await service.addQuery(newQuery, "alice-token");
    const bobQuery = await service.addQuery(newQuery, "bob-token");

    await expect(service.read("queries", "alice-token")).resolves.toEqual([
      aliceQuery,
    ]);
    await expect(service.read("queries", "bob-token")).resolves.toEqual([
      bobQuery,
    ]);
  });

  test("an ownership-bearing request cannot name another user as the owner", async () => {
    const queries = await createQueryStore();
    const service = createService({
      persistence: createMemoryPersistence(),
      queries,
      authStore: twoUserAuthStore(),
    });

    // There is no `user` field on the payload to begin with — naming one is
    // rejected outright rather than silently ignored, so nothing lands under
    // the name a caller tried to select.
    await expect(
      service.addQuery(
        { ...newQuery, user: "bob" } as unknown as NewQuery,
        "alice-token",
      ),
    ).rejects.toThrow();

    await expect(service.read("queries", "alice-token")).resolves.toEqual([]);
    await expect(service.read("queries", "bob-token")).resolves.toEqual([]);
  });

  test("an administrator deletes another user's query without ever reading it back", async () => {
    const queries = await createQueryStore();
    const service = createService({
      persistence: createMemoryPersistence(),
      queries,
      authStore: twoUserAuthStore(),
    });
    const stored = await service.addQuery(newQuery, "alice-token");

    // `removeUserQuery` resolves `void` — the service has no method that
    // could hand this query's integration, arguments, or mapper back to the
    // administrator, or to anyone but its owner.
    await expect(
      service.removeUserQuery("alice", stored.id, "admin-token"),
    ).resolves.toBeUndefined();

    await expect(service.read("queries", "alice-token")).resolves.toEqual([]);
  });

  test("a non-administrator cannot delete another user's query", async () => {
    const queries = await createQueryStore();
    const service = createService({
      persistence: createMemoryPersistence(),
      queries,
      authStore: twoUserAuthStore(),
    });
    const stored = await service.addQuery(newQuery, "alice-token");

    await expect(
      service.removeUserQuery("alice", stored.id, "bob-token"),
    ).rejects.toThrow("roles: read");

    await expect(service.read("queries", "alice-token")).resolves.toEqual([
      stored,
    ]);
  });

  test("editing or removing a query outside the caller's own store fails as unknown, not as someone else's", async () => {
    const queries = await createQueryStore();
    const service = createService({
      persistence: createMemoryPersistence(),
      queries,
      authStore: twoUserAuthStore(),
    });
    const stored = await service.addQuery(newQuery, "alice-token");

    await expect(
      service.editQuery(
        { ...stored, query: { calendarId: "other" } },
        "bob-token",
      ),
    ).rejects.toThrow(`Unknown query: ${stored.id}`);
    await expect(
      service.removeQuery(stored.id, "bob-token"),
    ).rejects.toThrow(`Unknown query: ${stored.id}`);

    // Untouched: bob's failed attempt did not reach alice's query.
    await expect(service.read("queries", "alice-token")).resolves.toEqual([
      stored,
    ]);
  });

  test("card state stays shared: whichever refresh's patch applies last is what every reader sees", async () => {
    // Simulates two users' independent refreshes racing against the same
    // card — each is its own `apply` call, exactly as two separate HTTP
    // refresh requests would produce (D30). The service's single serialized
    // queue (see the `ponytail:` note in `createService`) is what makes
    // "last write wins" a well-defined, observable outcome rather than a
    // coin flip between the two.
    const service = createService({ persistence: createMemoryPersistence() });

    await Promise.all([
      service.apply([
        {
          type: "patch-card-state",
          cardId: "welcome",
          patch: { message: "Alice's refresh" },
        },
      ]),
      service.apply([
        {
          type: "patch-card-state",
          cardId: "welcome",
          patch: { message: "Bob's refresh" },
        },
      ]),
    ]);

    await expect(service.read("cards")).resolves.toMatchObject([
      { state: { message: "Bob's refresh" } },
    ]);
  });
});

describe("card mapper store", () => {
  async function createQueryStore() {
    const dir = await mkdtemp(join(tmpdir(), "user-queries-"));
    return createEncryptedQueryStore(
      join(dir, "queries.json"),
      createSecretBox(randomBytes(32)),
    );
  }

  function twoUserAuthStore() {
    return {
      resolve: async (credential: string) =>
        credential === "alice-token"
          ? { user: "alice", role: "user" }
          : credential === "bob-token"
            ? { user: "bob", role: "user" }
            : credential === "admin-token"
              ? { user: "root", role: "admin" }
              : undefined,
    };
  }

  const spec: CardMapperSpec = {
    shape: "object",
    fields: { title: { from: ["summary"] } },
  };

  test("two queries naming one mapper resolve to the same stored spec", async () => {
    const service = createService({
      persistence: createMemoryPersistence(),
      queries: await createQueryStore(),
      authStore: twoUserAuthStore(),
    });

    await service.apply(
      [{ type: "add-card-mapper", name: "events", spec }],
      "alice-token",
    );
    await service.addQuery(
      { cardId: "welcome", integration: "calendar", query: {}, cardMapper: "events" },
      "alice-token",
    );
    await service.addQuery(
      { cardId: "welcome", integration: "calendar", query: {}, cardMapper: "events" },
      "bob-token",
    );

    // One stored mapper, not one copy per query — both queries name it.
    await expect(service.read("cardMappers", "alice-token")).resolves.toEqual([
      { name: "events", owner: "alice", spec },
    ]);
    const [aliceQueries, bobQueries] = await Promise.all([
      service.read("queries", "alice-token"),
      service.read("queries", "bob-token"),
    ]);
    expect(aliceQueries[0]?.cardMapper).toBe("events");
    expect(bobQueries[0]?.cardMapper).toBe("events");
  });

  test("a user can add a mapper but cannot edit another user's mapper", async () => {
    const service = createService({
      persistence: createMemoryPersistence(),
      queries: await createQueryStore(),
      authStore: twoUserAuthStore(),
    });

    await service.apply(
      [{ type: "add-card-mapper", name: "events", spec }],
      "alice-token",
    );

    await expect(
      service.apply(
        [{ type: "edit-card-mapper", name: "events", spec: { shape: "object", fields: {} } }],
        "bob-token",
      ),
    ).rejects.toThrow("cards: write");

    await expect(service.read("cardMappers", "alice-token")).resolves.toEqual([
      { name: "events", owner: "alice", spec },
    ]);
  });

  test("adding a card mapper under a name already present fails rather than overwriting", async () => {
    const service = createService({
      persistence: createMemoryPersistence(),
      queries: await createQueryStore(),
      authStore: twoUserAuthStore(),
    });

    await service.apply(
      [{ type: "add-card-mapper", name: "events", spec }],
      "alice-token",
    );

    await expect(
      service.apply(
        [
          {
            type: "add-card-mapper",
            name: "events",
            spec: { shape: "object", fields: { extra: { from: ["x"] } } },
          },
        ],
        "bob-token",
      ),
    ).rejects.toThrow("Duplicate");

    await expect(service.read("cardMappers", "alice-token")).resolves.toEqual([
      { name: "events", owner: "alice", spec },
    ]);
  });

  test("removing a referenced card mapper returns in-use and leaves the mapper and its queries intact", async () => {
    const service = createService({
      persistence: createMemoryPersistence(),
      queries: await createQueryStore(),
      authStore: twoUserAuthStore(),
    });

    await service.apply(
      [{ type: "add-card-mapper", name: "events", spec }],
      "alice-token",
    );
    const query = await service.addQuery(
      { cardId: "welcome", integration: "calendar", query: {}, cardMapper: "events" },
      "alice-token",
    );

    // Even an administrator cannot force it through — removal never
    // cascades into the private query that references it (D38).
    await expect(
      service.apply([{ type: "remove-card-mapper", name: "events" }], "admin-token"),
    ).rejects.toMatchObject({ code: "in-use" });

    await expect(service.read("cardMappers", "alice-token")).resolves.toEqual([
      { name: "events", owner: "alice", spec },
    ]);
    await expect(service.read("queries", "alice-token")).resolves.toEqual([
      query,
    ]);
  });

  test("editing a referenced card mapper requires cards: write, even for its owner", async () => {
    const service = createService({
      persistence: createMemoryPersistence(),
      queries: await createQueryStore(),
      authStore: twoUserAuthStore(),
    });

    await service.apply(
      [{ type: "add-card-mapper", name: "events", spec }],
      "alice-token",
    );
    await service.addQuery(
      { cardId: "welcome", integration: "calendar", query: {}, cardMapper: "events" },
      "alice-token",
    );

    await expect(
      service.apply(
        [{ type: "edit-card-mapper", name: "events", spec: { shape: "object", fields: {} } }],
        "alice-token",
      ),
    ).rejects.toThrow("cards: write");

    await expect(
      service.apply(
        [{ type: "edit-card-mapper", name: "events", spec: { shape: "object", fields: {} } }],
        "admin-token",
      ),
    ).resolves.toBeDefined();

    await expect(service.read("cardMappers", "alice-token")).resolves.toEqual([
      { name: "events", owner: "alice", spec: { shape: "object", fields: {} } },
    ]);
  });

  test("an owner may edit or remove their own unreferenced mapper without cards: write", async () => {
    const service = createService({
      persistence: createMemoryPersistence(),
      queries: await createQueryStore(),
      authStore: twoUserAuthStore(),
    });

    await service.apply(
      [{ type: "add-card-mapper", name: "events", spec }],
      "alice-token",
    );

    await expect(
      service.apply(
        [
          {
            type: "edit-card-mapper",
            name: "events",
            spec: { shape: "object", fields: { x: { from: ["y"] } } },
          },
        ],
        "alice-token",
      ),
    ).resolves.toBeDefined();

    await expect(
      service.apply([{ type: "remove-card-mapper", name: "events" }], "alice-token"),
    ).resolves.toBeDefined();

    await expect(service.read("cardMappers", "alice-token")).resolves.toEqual(
      [],
    );
  });
});

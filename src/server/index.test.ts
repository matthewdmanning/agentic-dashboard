import { describe, expect, test, vi } from "vitest";
import { userInfo } from "node:os";

import { defaultDashboardConfiguration, roles, type Role } from "../contract";
import {
  createService,
  type DashboardPersistence,
  type DashboardService,
} from "../service";
import type { StoredQuery, UserQueryStore } from "../service/queries";
import type { ConnectionStore } from "./integrations/connections";
import {
  handleDashboardConfigurationRequest,
  handleIntegrationConnectRequest,
  handleIntegrationDisconnectRequest,
  handleIntegrationRefreshRequest,
  handleIntegrationTypesRequest,
} from "./index";
import {
  useTestCardTemplates,
  withTestCard,
} from "../test-support/card-template";

function createMemoryPersistence(
  initial = defaultDashboardConfiguration,
): DashboardPersistence {
  let configuration = structuredClone(initial);
  return {
    read: async () => structuredClone(configuration),
    write: async (next) => {
      configuration = structuredClone(next);
    },
  };
}

/** Keyed by user and catalog entry (D40, #88), unlike the single-key credential store it replaced. */
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
    countForEntry: async (catalogEntryId) =>
      [...values.keys()].filter((existingKey) =>
        existingKey.endsWith(` ${catalogEntryId}`),
      ).length,
  };
}

function createMemoryUserQueryStore(): UserQueryStore {
  const values = new Map<string, StoredQuery[]>();
  return {
    list: async (user) => values.get(user) ?? [],
    add: async (user, query) => {
      values.set(user, [...(values.get(user) ?? []), query]);
    },
    edit: async (user, query) => {
      const entries = values.get(user) ?? [];
      const index = entries.findIndex(({ id }) => id === query.id);
      if (index === -1) return false;
      entries[index] = query;
      values.set(user, entries);
      return true;
    },
    remove: async (user, id) => {
      const entries = values.get(user) ?? [];
      const remaining = entries.filter((entry) => entry.id !== id);
      if (remaining.length === entries.length) return false;
      values.set(user, remaining);
      return true;
    },
    isReferencedByAnyQuery: async (mapperName) =>
      [...values.values()].some((entries) =>
        entries.some((entry) => entry.cardMapper === mapperName),
      ),
  };
}

function createTestService(
  initial = defaultDashboardConfiguration,
  extra: {
    connections?: ConnectionStore;
    connectableTypes?: string[];
    localUser?: Role;
    queries?: UserQueryStore;
  } = {},
): DashboardService {
  return createService({
    persistence: createMemoryPersistence(initial),
    queries: createMemoryUserQueryStore(),
    ...extra,
  });
}

describe("dashboard service HTTP transport", () => {
  test("reads the requested scope through the service", async () => {
    const response = await handleDashboardConfigurationRequest(
      new Request("http://dashboard/api/dashboard-configuration?scope=all"),
      createTestService(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      cards: defaultDashboardConfiguration.cards,
      cardMappers: defaultDashboardConfiguration.cardMappers,
      dashboard: defaultDashboardConfiguration.dashboard,
      themes: defaultDashboardConfiguration.themes,
      fontScale: defaultDashboardConfiguration.fontScale,
      integrations: defaultDashboardConfiguration.integrations,
      integrationRetentionDays:
        defaultDashboardConfiguration.integrationRetentionDays,
      roles,
    });
  });

  test("applies mutation lists through the service", async () => {
    const service = createTestService();
    const response = await handleDashboardConfigurationRequest(
      new Request("http://dashboard/api/dashboard-configuration", {
        method: "POST",
        body: JSON.stringify([
          {
            type: "set-font-scale",
            fontScale: 1.25,
          },
        ]),
      }),
      service,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ fontScale: 1.25 });
  });

  test("returns service permission errors without a second authorization check", async () => {
    const response = await handleDashboardConfigurationRequest(
      new Request("http://dashboard/api/dashboard-configuration?scope=roles"),
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

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "permission-denied",
    });
  });

  test("maps each service failure onto its own status", async () => {
    const service = createTestService();

    const missing = await handleDashboardConfigurationRequest(
      new Request("http://dashboard/api/dashboard-configuration", {
        method: "POST",
        body: JSON.stringify([
          { type: "edit-theme", theme: { id: "absent", settings: {} } },
        ]),
      }),
      service,
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ code: "unknown-id" });

    const inUse = await handleDashboardConfigurationRequest(
      new Request("http://dashboard/api/dashboard-configuration", {
        method: "POST",
        body: JSON.stringify([{ type: "remove-theme", themeId: "calm" }]),
      }),
      service,
    );
    expect(inUse.status).toBe(409);
    await expect(inUse.json()).resolves.toMatchObject({ code: "in-use" });

    const unauthenticated = await handleDashboardConfigurationRequest(
      new Request("http://dashboard/api/dashboard-configuration", {
        headers: { authorization: "Basic nope" },
      }),
      service,
    );
    expect(unauthenticated.status).toBe(401);
  });
});

describe("integration refresh endpoint", () => {
  useTestCardTemplates();

  const calendarMapperSpec = {
    shape: "array" as const,
    from: ["items"],
    into: "events",
    fields: {
      id: { from: ["id"], coerce: "string" as const },
      title: { from: ["summary"], default: "Untitled event" },
      start: { from: ["start.dateTime"] },
    },
  };

  const calendarQuery = {
    integration: "team-calendar",
    query: { calendarId: "team" },
    cardMapper: "events",
  };

  test("runs the caller's own queries through the service and patches card state", async () => {
    const source = {
      items: [
        {
          id: "event-1",
          summary: "Planning",
          start: { dateTime: "2026-08-27T09:00:00-04:00" },
        },
      ],
    };
    const pull = vi.fn(async () => Response.json(source));
    const service = createTestService({
      ...defaultDashboardConfiguration,
      integrations: [
        { id: "team-calendar", type: "google-calendar", settings: {} },
        { id: "unknown", type: "not-built-in", settings: {} },
      ],
      cards: [
        ...defaultDashboardConfiguration.cards,
        {
          id: "calendar-card",
          title: "Calendar",
          template: "calendar",
          state: { events: [] },
        },
        {
          id: "unsupported-card",
          title: "Unsupported",
          template: "message",
          state: { message: "unchanged" },
        },
      ],
    });
    await service.apply([
      { type: "add-card-mapper", name: "events", spec: calendarMapperSpec },
    ]);
    await service.addQuery({ ...calendarQuery, cardId: "calendar-card" });
    await service.addQuery({
      cardId: "unsupported-card",
      integration: "unknown",
      query: {},
      cardMapper: "identity",
    });
    const connections = createMemoryConnectionStore();
    await connections.set(userInfo().username, "team-calendar", "access-token");

    const response = await handleIntegrationRefreshRequest(
      new Request("http://dashboard/api/integrations/refresh", {
        method: "POST",
      }),
      { service, connections, fetch: pull },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { cardId: "calendar-card", status: "refreshed" },
      { cardId: "unsupported-card", status: "unsupported" },
    ]);

    const cards = await service.read("cards");
    expect(cards.find(({ id }) => id === "calendar-card")).toMatchObject({
      state: {
        events: [
          {
            id: "event-1",
            title: "Planning",
            start: "2026-08-27T09:00:00-04:00",
          },
        ],
      },
    });
    expect(cards.find(({ id }) => id === "unsupported-card")).toMatchObject({
      state: { message: "unchanged" },
    });
  });

  test("two queries naming one card mapper are shaped through the same stored spec", async () => {
    const source = {
      items: [
        {
          id: "event-1",
          summary: "Planning",
          start: { dateTime: "2026-08-27T09:00:00-04:00" },
        },
      ],
    };
    const pull = vi.fn(async () => Response.json(source));
    const service = createTestService({
      ...defaultDashboardConfiguration,
      integrations: [
        { id: "team-calendar", type: "google-calendar", settings: {} },
      ],
      cards: [
        ...defaultDashboardConfiguration.cards,
        {
          id: "card-a",
          title: "A",
          template: "calendar",
          state: { events: [] },
        },
        {
          id: "card-b",
          title: "B",
          template: "calendar",
          state: { events: [] },
        },
      ],
    });
    await service.apply([
      { type: "add-card-mapper", name: "events", spec: calendarMapperSpec },
    ]);
    await service.addQuery({ ...calendarQuery, cardId: "card-a" });
    await service.addQuery({ ...calendarQuery, cardId: "card-b" });
    const connections = createMemoryConnectionStore();
    await connections.set(userInfo().username, "team-calendar", "access-token");

    const response = await handleIntegrationRefreshRequest(
      new Request("http://dashboard/api/integrations/refresh", {
        method: "POST",
      }),
      { service, connections, fetch: pull },
    );

    expect(response.status).toBe(200);
    const cards = await service.read("cards");
    const cardA = cards.find(({ id }) => id === "card-a");
    const cardB = cards.find(({ id }) => id === "card-b");
    // Both cards were shaped by the one stored mapper, not by separate
    // copies — the resolved output is identical.
    expect(cardA?.state).toEqual(cardB?.state);
    expect(cardA?.state).toMatchObject({
      events: [{ id: "event-1", title: "Planning" }],
    });
  });

  test("reports one card query's failure without stopping the rest", async () => {
    const service = createTestService({
      ...defaultDashboardConfiguration,
      integrations: [
        { id: "team-calendar", type: "google-calendar", settings: {} },
      ],
      cards: [
        ...defaultDashboardConfiguration.cards,
        {
          id: "calendar-card",
          title: "Calendar",
          template: "calendar",
          state: { events: [] },
        },
      ],
    });
    await service.apply([
      { type: "add-card-mapper", name: "events", spec: calendarMapperSpec },
    ]);
    await service.addQuery({ ...calendarQuery, cardId: "calendar-card" });

    const response = await handleIntegrationRefreshRequest(
      new Request("http://dashboard/api/integrations/refresh", {
        method: "POST",
      }),
      { service, connections: createMemoryConnectionStore() },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        cardId: "calendar-card",
        status: "failed",
        message:
          "Integration 'team-calendar' is not connected. Connect it in Settings.",
      },
    ]);
  });

  test("two users querying the same integration use their own distinct connections, and losing one breaks only that user's refresh (#90)", async () => {
    const configuration = {
      ...defaultDashboardConfiguration,
      integrations: [
        { id: "team-calendar", type: "google-calendar", settings: {} },
      ],
      cards: [
        ...defaultDashboardConfiguration.cards,
        {
          id: "alice-card",
          title: "Alice",
          template: "calendar",
          state: { events: [] },
        },
        {
          id: "bob-card",
          title: "Bob",
          template: "calendar",
          state: { events: [] },
        },
      ],
    };
    const authStore = {
      resolve: async (credential: string) =>
        credential === "alice-token"
          ? { user: "alice", role: "user" }
          : credential === "bob-token"
            ? { user: "bob", role: "user" }
            : undefined,
    };
    const service = createService({
      persistence: createMemoryPersistence(configuration),
      authStore,
      queries: createMemoryUserQueryStore(),
    });
    await service.apply([
      { type: "add-card-mapper", name: "events", spec: calendarMapperSpec },
    ]);
    await service.addQuery(
      { ...calendarQuery, cardId: "alice-card" },
      "alice-token",
    );
    await service.addQuery(
      { ...calendarQuery, cardId: "bob-card" },
      "bob-token",
    );
    const connections = createMemoryConnectionStore();
    await connections.set("alice", "team-calendar", "alice-secret");
    await connections.set("bob", "team-calendar", "bob-secret");
    const pull = vi.fn(async (_url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string>)
        .Authorization;
      if (authorization === "Bearer alice-secret") {
        return Response.json({
          items: [
            {
              id: "a1",
              summary: "Alice Event",
              start: { dateTime: "2026-01-01T00:00:00Z" },
            },
          ],
        });
      }
      if (authorization === "Bearer bob-secret") {
        return Response.json({
          items: [
            {
              id: "b1",
              summary: "Bob Event",
              start: { dateTime: "2026-01-02T00:00:00Z" },
            },
          ],
        });
      }
      throw new Error(`Unexpected credential: ${authorization}`);
    });

    await handleIntegrationRefreshRequest(
      new Request("http://dashboard/api/integrations/refresh", {
        method: "POST",
        headers: { authorization: "Bearer alice-token" },
      }),
      { service, connections, fetch: pull },
    );
    await handleIntegrationRefreshRequest(
      new Request("http://dashboard/api/integrations/refresh", {
        method: "POST",
        headers: { authorization: "Bearer bob-token" },
      }),
      { service, connections, fetch: pull },
    );

    const cards = await service.read("cards", "alice-token");
    expect(cards.find(({ id }) => id === "alice-card")).toMatchObject({
      state: { events: [{ id: "a1", title: "Alice Event" }] },
    });
    expect(cards.find(({ id }) => id === "bob-card")).toMatchObject({
      state: { events: [{ id: "b1", title: "Bob Event" }] },
    });

    // Losing alice's connection breaks only alice's refresh.
    await connections.remove("alice", "team-calendar");
    const aliceRetry = await handleIntegrationRefreshRequest(
      new Request("http://dashboard/api/integrations/refresh", {
        method: "POST",
        headers: { authorization: "Bearer alice-token" },
      }),
      { service, connections, fetch: pull },
    );
    await expect(aliceRetry.json()).resolves.toEqual([
      {
        cardId: "alice-card",
        status: "failed",
        message:
          "Integration 'team-calendar' is not connected. Connect it in Settings.",
      },
    ]);
    const bobRetry = await handleIntegrationRefreshRequest(
      new Request("http://dashboard/api/integrations/refresh", {
        method: "POST",
        headers: { authorization: "Bearer bob-token" },
      }),
      { service, connections, fetch: pull },
    );
    await expect(bobRetry.json()).resolves.toEqual([
      { cardId: "bob-card", status: "refreshed" },
    ]);
  });

  test("a mapped result that does not fit its card's template schema is rejected before it reaches shared state (#90)", async () => {
    const service = createTestService({
      ...defaultDashboardConfiguration,
      integrations: [
        { id: "team-calendar", type: "google-calendar", settings: {} },
      ],
      cards: [
        ...defaultDashboardConfiguration.cards,
        {
          id: "calendar-card",
          title: "Calendar",
          template: "calendar",
          state: { events: [] },
        },
      ],
    });
    // This spec's output never carries `title`, which the calendar template
    // requires -- every mapped event fails the schema.
    await service.apply([
      {
        type: "add-card-mapper",
        name: "titleless-events",
        spec: {
          shape: "array",
          from: ["items"],
          into: "events",
          fields: { id: { from: ["id"], coerce: "string" } },
        },
      },
    ]);
    await service.addQuery({
      integration: "team-calendar",
      query: { calendarId: "team" },
      cardMapper: "titleless-events",
      cardId: "calendar-card",
    });
    const connections = createMemoryConnectionStore();
    await connections.set(userInfo().username, "team-calendar", "access-token");
    const pull = vi.fn(async () =>
      Response.json({ items: [{ id: "event-1" }] }),
    );

    const response = await handleIntegrationRefreshRequest(
      new Request("http://dashboard/api/integrations/refresh", {
        method: "POST",
      }),
      { service, connections, fetch: pull },
    );

    expect(response.status).toBe(200);
    const body: Array<{ cardId: string; status: string; message?: string }> =
      await response.json();
    expect(body).toEqual([
      expect.objectContaining({ cardId: "calendar-card", status: "failed" }),
    ]);
    expect(body[0]?.message).toMatch(/card template/i);

    const cards = await service.read("cards");
    expect(cards.find(({ id }) => id === "calendar-card")).toMatchObject({
      state: { events: [] },
    });
  });
});

describe("integration types endpoint", () => {
  test("lists the services this build can pull from", async () => {
    const service = createTestService(defaultDashboardConfiguration, {
      connectableTypes: ["google-calendar"],
    });

    const response = await handleIntegrationTypesRequest(
      new Request("http://dashboard/api/integrations/types"),
      service,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(["google-calendar"]);
  });

  test("resolves a role like every other request, refusing a caller with no integrations access", async () => {
    const service = createTestService(defaultDashboardConfiguration, {
      connectableTypes: ["google-calendar"],
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
    });

    const response = await handleIntegrationTypesRequest(
      new Request("http://dashboard/api/integrations/types"),
      service,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "permission-denied",
    });
  });
});

describe("integration connect endpoint", () => {
  test("stores a connection's credential through the one enforcement point", async () => {
    const connections = createMemoryConnectionStore();
    const service = createTestService(
      {
        ...defaultDashboardConfiguration,
        integrations: [
          { id: "team-calendar", type: "google-calendar", settings: {} },
        ],
      },
      { connections },
    );

    const response = await handleIntegrationConnectRequest(
      new Request("http://dashboard/api/integrations/connect", {
        method: "POST",
        body: JSON.stringify({
          integrationId: "team-calendar",
          credential: "secret-token",
        }),
      }),
      service,
    );

    expect(response.status).toBe(200);
    // No `authStore` configured — the caller resolves to the local OS user.
    await expect(
      connections.get(userInfo().username, "team-calendar"),
    ).resolves.toBe("secret-token");
  });

  test("a caller with no integrations permission still connects their own account (D35)", async () => {
    const connections = createMemoryConnectionStore();
    const service = createTestService(
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
    );

    const response = await handleIntegrationConnectRequest(
      new Request("http://dashboard/api/integrations/connect", {
        method: "POST",
        body: JSON.stringify({
          integrationId: "team-calendar",
          credential: "secret-token",
        }),
      }),
      service,
    );

    expect(response.status).toBe(200);
    await expect(
      connections.get(userInfo().username, "team-calendar"),
    ).resolves.toBe("secret-token");
  });

  test("requires both an integrationId and a credential", async () => {
    const response = await handleIntegrationConnectRequest(
      new Request("http://dashboard/api/integrations/connect", {
        method: "POST",
        body: JSON.stringify({ integrationId: "team-calendar" }),
      }),
      createTestService(defaultDashboardConfiguration, {
        connections: createMemoryConnectionStore(),
      }),
    );

    expect(response.status).toBe(400);
  });
});

describe("integration disconnect endpoint", () => {
  test("destroys the caller's stored credential immediately and leaves the catalog entry intact", async () => {
    const connections = createMemoryConnectionStore();
    await connections.set(userInfo().username, "team-calendar", "secret-token");
    const service = createTestService(
      {
        ...defaultDashboardConfiguration,
        integrations: [
          { id: "team-calendar", type: "google-calendar", settings: {} },
        ],
      },
      { connections },
    );

    const response = await handleIntegrationDisconnectRequest(
      new Request("http://dashboard/api/integrations/disconnect", {
        method: "POST",
        body: JSON.stringify({ integrationId: "team-calendar" }),
      }),
      service,
    );

    expect(response.status).toBe(200);
    await expect(
      connections.get(userInfo().username, "team-calendar"),
    ).resolves.toBeUndefined();
    await expect(service.read("integrations")).resolves.toEqual([
      { id: "team-calendar", type: "google-calendar", settings: {} },
    ]);
  });

  test("requires an integrationId", async () => {
    const response = await handleIntegrationDisconnectRequest(
      new Request("http://dashboard/api/integrations/disconnect", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      createTestService(defaultDashboardConfiguration, {
        connections: createMemoryConnectionStore(),
      }),
    );

    expect(response.status).toBe(400);
  });
});

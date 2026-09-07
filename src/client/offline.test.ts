import { describe, expect, test } from "vitest";

import { defaultDashboardConfiguration, type Mutation } from "../contract";
import {
  enqueue,
  pendingMutationCount,
  readCachedDashboard,
  replayQueue,
  requiresLiveService,
  writeCachedDashboard,
  type KeyValueStore,
} from "./offline";
import { RequestFailure } from "./request";

function createMemoryStore(): KeyValueStore {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const setFontScale: Mutation = { type: "set-font-scale", fontScale: 1.2 };
const addIntegration: Mutation = {
  type: "add-integration",
  integration: { id: "example", type: "example-service", settings: {} },
};

describe("offline cache", () => {
  test("overwrites on each write and holds nothing else", () => {
    const store = createMemoryStore();
    expect(readCachedDashboard(store)).toBeUndefined();

    writeCachedDashboard(store, {
      dashboard: defaultDashboardConfiguration.dashboard,
      fontScale: 1,
    });
    writeCachedDashboard(store, {
      dashboard: defaultDashboardConfiguration.dashboard,
      fontScale: 1.5,
    });

    expect(readCachedDashboard(store)).toEqual({
      dashboard: defaultDashboardConfiguration.dashboard,
      fontScale: 1.5,
    });
  });

  test("a cache that fails to parse is a cache miss, not a crash", () => {
    const store = createMemoryStore();
    store.setItem(
      "dashboard-cache:home",
      JSON.stringify({ dashboard: { id: "home" }, fontScale: "not-a-number" }),
    );

    expect(readCachedDashboard(store)).toBeUndefined();
  });

  test("unparseable JSON is also a cache miss", () => {
    const store = createMemoryStore();
    store.setItem("dashboard-cache:home", "{not json");

    expect(readCachedDashboard(store)).toBeUndefined();
  });
});

describe("mutation queue", () => {
  test("an integrations mutation is never queued", () => {
    expect(requiresLiveService([addIntegration])).toBe(true);
    expect(requiresLiveService([setFontScale])).toBe(false);
  });

  test("a queued mutation applies after reconnect", async () => {
    const store = createMemoryStore();
    enqueue(store, [setFontScale]);
    expect(pendingMutationCount(store)).toBe(1);

    const applied: (readonly Mutation[])[] = [];
    const { dropped } = await replayQueue(store, async (mutations) => {
      applied.push(mutations);
    });

    expect(applied).toEqual([[setFontScale]]);
    expect(dropped).toEqual([]);
    expect(pendingMutationCount(store)).toBe(0);
  });

  test("a permission denial on replay drops the group and reports it", async () => {
    const store = createMemoryStore();
    enqueue(store, [setFontScale]);

    const { dropped } = await replayQueue(store, async () => {
      throw new RequestFailure("permission-denied", "Permission denied");
    });

    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.code).toBe("permission-denied");
    expect(pendingMutationCount(store)).toBe(0);
  });

  test("an unknown-id failure on replay drops the group and reports it", async () => {
    const store = createMemoryStore();
    enqueue(store, [
      { type: "edit-theme", theme: { id: "gone", settings: {} } },
    ]);

    const { dropped } = await replayQueue(store, async () => {
      throw new RequestFailure("unknown-id", "Unknown theme: gone");
    });

    expect(dropped).toHaveLength(1);
    expect(pendingMutationCount(store)).toBe(0);
  });

  test("a transport failure stops replay and leaves the queue intact", async () => {
    const store = createMemoryStore();
    enqueue(store, [setFontScale]);
    enqueue(store, [{ type: "set-font-scale", fontScale: 1.8 }]);

    const attempts: (readonly Mutation[])[] = [];
    const { dropped } = await replayQueue(store, async (mutations) => {
      attempts.push(mutations);
      throw new TypeError("Failed to fetch");
    });

    expect(attempts).toEqual([[setFontScale]]);
    expect(dropped).toEqual([]);
    expect(pendingMutationCount(store)).toBe(2);
  });

  test("replay resumes past what already succeeded or was dropped", async () => {
    const store = createMemoryStore();
    enqueue(store, [setFontScale]);
    enqueue(store, [{ type: "set-font-scale", fontScale: 1.8 }]);

    let call = 0;
    await replayQueue(store, async () => {
      call++;
      if (call === 1) throw new TypeError("network down");
    });
    expect(pendingMutationCount(store)).toBe(2);

    const { dropped } = await replayQueue(store, async () => undefined);
    expect(dropped).toEqual([]);
    expect(pendingMutationCount(store)).toBe(0);
  });
});

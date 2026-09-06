import { describe, expect, test } from "vitest";

import {
  catalogEntriesForAdapters,
  connectableTypesFromCatalog,
} from "./catalog-queries";

const entries = [
  {
    id: "one",
    type: "calendar",
    settings: {},
    origin: "default",
    state: "available",
  },
  {
    id: "two",
    type: "calendar",
    settings: {},
    origin: "recommended",
    state: "available",
  },
  {
    id: "blocked",
    type: "mail",
    settings: {},
    origin: "dynamic",
    state: "blocked",
  },
] as const;

describe("catalog-backed integration choices", () => {
  test("uses available catalog types, not registry keys", () => {
    expect(connectableTypesFromCatalog(entries)).toEqual(["calendar"]);
  });

  test("derives adapter-supported entries from catalog types", () => {
    expect(catalogEntriesForAdapters(entries, { calendar: {} })).toEqual([
      entries[0],
      entries[1],
    ]);
  });
});

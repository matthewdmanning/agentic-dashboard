import { describe, expect, it } from "vitest";

import { applyMutations } from "./store";
import {
  EMPTY_DASHBOARD,
  MutationError,
  type Dashboard,
  type Mutation,
  type Tile,
} from "./types";

const tile = (id: string): Tile => ({
  id,
  title: id,
  item: "stat-tile",
  state: { LABEL: id, VALUE: 1 },
});

const add = (
  id: string,
  mutation: Partial<Extract<Mutation, { type: "add-tile" }>> = {},
): Mutation => ({
  type: "add-tile",
  tile: tile(id),
  ...mutation,
});

const two: Dashboard = applyMutations(EMPTY_DASHBOARD, [add("a"), add("b")]);

describe("applyMutations", () => {
  it("places a new tile last at md, since that is the width an agent gets without asking", () => {
    expect(two.references).toEqual([
      { tileId: "a", size: "md" },
      { tileId: "b", size: "md" },
    ]);
  });

  it("orders by index, so 'put this first' is expressible", () => {
    const moved = applyMutations(two, [
      { type: "place-tile", tileId: "b", index: 0 },
    ]);

    expect(moved.references.map((reference) => reference.tileId)).toEqual([
      "b",
      "a",
    ]);
  });

  it("keeps a tile's size when only its position moves", () => {
    const resized = applyMutations(two, [
      { type: "place-tile", tileId: "a", size: "lg" },
    ]);
    const moved = applyMutations(resized, [
      { type: "place-tile", tileId: "a", index: 1 },
    ]);

    expect(moved.references).toContainEqual({ tileId: "a", size: "lg" });
  });

  it("drops a removed tile's reference as well as the tile", () => {
    const removed = applyMutations(two, [{ type: "remove-tile", tileId: "a" }]);

    expect(removed.tiles.map((entry) => entry.id)).toEqual(["b"]);
    expect(removed.references.map((reference) => reference.tileId)).toEqual([
      "b",
    ]);
  });

  it("names the failure rather than throwing prose a caller has to match on", () => {
    expect(() =>
      applyMutations(two, [
        { type: "set-tile-state", tileId: "missing", state: {} },
      ]),
    ).toThrowError(
      expect.objectContaining({ failure: "unknown-tile" }) as MutationError,
    );
  });

  it("applies all or nothing — a later failure leaves no trace of an earlier success", () => {
    expect(() =>
      applyMutations(two, [
        add("c"),
        { type: "remove-tile", tileId: "missing" },
      ]),
    ).toThrow();

    expect(two.tiles.map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});

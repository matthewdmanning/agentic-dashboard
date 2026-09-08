import { describe, expect, test } from "vitest";

import {
  defaultDashboardConfiguration,
  parseDashboardConfiguration,
} from "../contract";
import { includedCardTemplates } from "../client/cards";
import { activeCardTemplateManifest } from "./manifest";

describe("active card-template manifest", () => {
  test("contains a schema and renderable client entry for every template", () => {
    const names = Object.keys(activeCardTemplateManifest);

    expect(names.length).toBeGreaterThan(0);
    expect(Object.keys(includedCardTemplates).sort()).toEqual(names.sort());
    for (const name of names) {
      const entry = activeCardTemplateManifest[name];
      expect(entry.jsonSchema).toEqual(
        expect.objectContaining({ type: "object" }),
      );
      expect(entry.schema.safeParse({ message: "hello" }).success).toBe(true);
    }
  });

  test("the default dashboard names a state-valid active template", () => {
    expect(defaultDashboardConfiguration.dashboard.cards).toEqual(["welcome"]);
    expect(() =>
      parseDashboardConfiguration(defaultDashboardConfiguration),
    ).not.toThrow();
  });
});

import { describe, expect, test } from "vitest";

import { defaultDashboardConfiguration } from "../contract";
import {
  settingsMutations,
  type DashboardSettings,
} from "./settings-mutations";

const saved: DashboardSettings = {
  dashboard: defaultDashboardConfiguration.dashboard,
  themes: defaultDashboardConfiguration.themes,
  integrations: [{ id: "team", type: "example-service", settings: {} }],
};

describe("settings mutations", () => {
  test("an untouched draft asks for nothing", () => {
    expect(settingsMutations(saved, { ...saved })).toEqual([]);
  });

  test("edits what exists and creates what does not", () => {
    const mutations = settingsMutations(saved, {
      ...saved,
      themes: [
        { id: "calm", settings: { density: "compact" } },
        { id: "contrast", settings: {} },
      ],
    });

    expect(mutations).toEqual([
      {
        type: "edit-theme",
        theme: { id: "calm", settings: { density: "compact" } },
      },
      { type: "add-theme", theme: { id: "contrast", settings: {} } },
    ]);
  });

  test("removing a theme removes it rather than editing what remains", () => {
    expect(
      settingsMutations(
        {
          ...saved,
          themes: [...saved.themes!, { id: "contrast", settings: {} }],
        },
        saved,
      ),
    ).toEqual([{ type: "remove-theme", themeId: "contrast" }]);
  });

  test("connecting and disconnecting an integration", () => {
    const connected = settingsMutations(saved, {
      ...saved,
      integrations: [
        ...saved.integrations!,
        { id: "second", type: "other-service", settings: {} },
      ],
    });
    expect(connected).toEqual([
      {
        type: "add-integration",
        integration: { id: "second", type: "other-service", settings: {} },
      },
    ]);

    expect(settingsMutations(saved, { ...saved, integrations: [] })).toEqual([
      { type: "remove-integration", integrationId: "team" },
    ]);
  });

  test("a category the caller could not read produces nothing", () => {
    const withoutIntegrations: DashboardSettings = {
      dashboard: saved.dashboard,
      themes: saved.themes,
    };

    expect(
      settingsMutations(withoutIntegrations, {
        ...withoutIntegrations,
        integrations: [{ id: "smuggled", type: "example", settings: {} }],
      }),
    ).toEqual([]);
  });
});

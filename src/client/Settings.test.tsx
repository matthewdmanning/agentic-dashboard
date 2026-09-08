import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  defaultDashboardConfiguration,
  defaultUserAppearance,
  presetTokens,
  type Mutation,
  type Preset,
} from "../contract";
import { parsePersonalPreset, withPersonalPreset } from "./appearance-client";
import { Settings } from "./Settings";

function samplePreset(overrides: Partial<Preset> = {}): Preset {
  const block = Object.fromEntries(
    presetTokens.map((token) => [token, "oklch(0.5 0 0)"]),
  ) as Preset["light"];
  return {
    themeMapping: { "--color-background": "var(--background)" },
    light: block,
    dark: block,
    radius: "0.5rem",
    baseRules: "default",
    ...overrides,
  };
}

function render(
  dashboard: Parameters<typeof Settings>[0]["dashboard"],
  callerRole?: Parameters<typeof Settings>[0]["callerRole"],
  blockedIntegrationNotices: string[] = [],
  unavailableQueryNotices: string[] = [],
  appearance: Parameters<typeof Settings>[0]["appearance"] = {
    ...defaultUserAppearance,
    css: "",
  },
) {
  return renderToStaticMarkup(
    createElement(Settings, {
      dashboard,
      callerRole,
      connectableTypes: ["example-service"],
      blockedIntegrationNotices,
      unavailableQueryNotices,
      appearance,
      onSave: async () => undefined,
      onConnect: async () => undefined,
      onSetAppearance: async () => undefined,
    }),
  );
}

/**
 * The markup of one fieldset, so a control elsewhere cannot satisfy the test.
 * The legend is matched loosely because it is composed from `FieldLegend`,
 * which carries its own `data-slot` and classes.
 */
function fieldset(html: string, legend: string): string {
  const start = html.search(new RegExp(`<legend[^>]*>${legend}</legend>`));
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</fieldset>", start));
}

/**
 * The value each choice control currently shows. The options themselves live
 * in a popup that static rendering never opens, so what a rendered control
 * reveals is its selection — which is the part these tests are about. That the
 * options are closed to a supported vocabulary is enforced by the contract and
 * covered in `contract/index.test.ts`; here the controls are driven straight
 * from those same exported vocabularies.
 */
function shownValues(html: string): string[] {
  return [...html.matchAll(/data-slot="select-value"[^>]*>([^<]*)/g)].map(
    (match) => match[1],
  );
}

describe("Settings contract", () => {
  test("omits a category the caller may not read", () => {
    const html = render({
      dashboard: defaultDashboardConfiguration.dashboard,
      themes: defaultDashboardConfiguration.themes,
    });

    expect(html).toContain("Theme");
    expect(html).not.toContain("Integrations");
    expect(html).not.toContain("Roles");
  });

  test("shows the caller its own role, read-only", () => {
    const own = fieldset(
      render(
        {},
        {
          name: "localUser",
          permissions: {
            data: "write",
            cards: "write",
            presentation: "write",
            integrations: "write",
            roles: "noAccess",
          },
        },
      ),
      "Your role",
    );

    expect(own).toContain("localUser");
    expect(own).toContain("roles: noAccess");
    expect(own).not.toContain("<select");
    expect(own).not.toContain("<button");
  });

  test("renders roles read-only, with no control to change one", () => {
    const html = render({
      roles: [
        {
          name: "reader",
          permissions: {
            data: "noAccess",
            cards: "read",
            presentation: "edit",
            integrations: "write",
            roles: "noAccess",
          },
        },
      ],
    });

    const roles = fieldset(html, "Roles");
    expect(roles).toContain("presentation: edit");
    expect(roles).toContain("integrations: write");
    expect(roles).not.toContain("<select");
    expect(roles).not.toContain("<input");
    expect(roles).not.toContain("<button");
  });

  test("names an integration's connection without naming any service", () => {
    const integrations = fieldset(
      render({
        integrations: [
          { id: "team-calendar", type: "example-service", settings: {} },
        ],
      }),
      "Integrations",
    );

    expect(integrations).toContain("team-calendar");
    expect(integrations).toContain("example-service");
    expect(integrations).toContain("Disconnect");
    // The panel connects and disconnects; a card's query decides what is shown.
    expect(integrations).not.toContain("calendarId");
  });

  test("shows a persistent notice for a blocked integration, without naming any other user (#92)", () => {
    const integrations = fieldset(
      render(
        {
          integrations: [
            { id: "team-calendar", type: "example-service", settings: {} },
          ],
        },
        undefined,
        ["team-calendar"],
      ),
      "Integrations",
    );

    expect(integrations).toContain("Blocked");
    expect(integrations).toContain("team-calendar");
  });

  test("shows no blocked notice when nothing is blocked", () => {
    const integrations = fieldset(
      render({
        integrations: [
          { id: "team-calendar", type: "example-service", settings: {} },
        ],
      }),
      "Integrations",
    );

    expect(integrations).not.toContain("Blocked");
  });

  test("shows a persistent notice for a query whose integration was removed (#93)", () => {
    const integrations = fieldset(
      render(
        {
          integrations: [
            { id: "team-calendar", type: "example-service", settings: {} },
          ],
        },
        undefined,
        [],
        ["deleted-integration"],
      ),
      "Integrations",
    );

    expect(integrations).toContain("no longer exists");
    expect(integrations).toContain("deleted-integration");
  });

  test("shows no unavailable-query notice when nothing is unavailable", () => {
    const integrations = fieldset(
      render({
        integrations: [
          { id: "team-calendar", type: "example-service", settings: {} },
        ],
      }),
      "Integrations",
    );

    expect(integrations).not.toContain("no longer exists");
  });

  test("shows the caller's own base colour, ungated by any permission (#94)", () => {
    const appearance = fieldset(
      render({}, undefined, [], [], {
        ...defaultUserAppearance,
        baseColour: "slate",
        css: "",
      }),
      "Appearance",
    );

    expect(shownValues(appearance)).toContain("slate");
  });

  test("renders the Appearance fieldset even with no permission bundle at all", () => {
    const html = render({});

    expect(html).toContain("Appearance");
  });

  test("shows the caller's own typeset and menu treatment, closed to the supported vocabularies (#95)", () => {
    const appearance = fieldset(
      render({}, undefined, [], [], {
        ...defaultUserAppearance,
        typeset: {
          size: 1.2,
          leading: "relaxed",
          flow: "balance",
          bodyFont: "serif",
          headingFont: "mono",
          monospaceFont: "sans",
        },
        menuColour: "inverted",
        menuAccent: "bold",
        css: "",
      }),
      "Appearance",
    );

    expect(shownValues(appearance)).toEqual(
      expect.arrayContaining([
        "relaxed",
        "balance",
        "serif",
        "mono",
        "sans",
        "inverted",
        "bold",
      ]),
    );
    expect(appearance).not.toContain("Font scale");
  });

  test("lists server presets with a select control, ungated by any permission (#96)", () => {
    const appearance = fieldset(
      render(
        { presets: [{ id: "midnight", preset: samplePreset() }] },
        undefined,
        [],
        [],
        { ...defaultUserAppearance, css: "" },
      ),
      "Appearance",
    );

    expect(appearance).toContain("Server presets");
    expect(appearance).toContain("midnight");
    expect(appearance).toContain("Select");
  });

  test("lists the caller's own presets with select and remove controls (#96)", () => {
    const appearance = fieldset(
      render({}, undefined, [], [], {
        ...defaultUserAppearance,
        personalPresets: [{ id: "my-theme", preset: samplePreset() }],
        css: "",
      }),
      "Appearance",
    );

    expect(appearance).toContain("Your presets");
    expect(appearance).toContain("my-theme");
    expect(appearance).toContain("Remove");
  });

  test("shows a clear-selection control only once a preset is selected (#96)", () => {
    const unselected = fieldset(render({}), "Appearance");
    expect(unselected).not.toContain("Clear preset selection");

    const selected = fieldset(
      render({}, undefined, [], [], {
        ...defaultUserAppearance,
        selectedPreset: { source: "server", id: "midnight" },
        css: "",
      }),
      "Appearance",
    );
    expect(selected).toContain("Clear preset selection");
  });
});

describe("personal presets (#96)", () => {
  test("offers a control to add one, ungated by any permission", () => {
    const appearance = fieldset(render({}), "Appearance");

    expect(appearance).toContain("Add a preset");
    expect(appearance).toContain("Preset name");
    expect(appearance).toContain("Save preset");
  });

  test("reads a complete token set as the caller's own preset", () => {
    const preset = samplePreset();

    expect(parsePersonalPreset("my-theme", JSON.stringify(preset))).toEqual({
      id: "my-theme",
      preset,
    });
  });

  test("rejects a partial token set rather than storing it", () => {
    const { dark: _dark, ...partial } = samplePreset();

    expect(() =>
      parsePersonalPreset("my-theme", JSON.stringify(partial)),
    ).toThrow(/Not a complete preset/);
  });

  test("rejects text that is not JSON at all", () => {
    expect(() => parsePersonalPreset("my-theme", "oklch(0.5 0 0)")).toThrow(
      /not valid JSON/,
    );
  });

  test("reusing a name replaces that preset rather than adding a second", () => {
    const first = { id: "my-theme", preset: samplePreset() };
    const replacement = {
      id: "my-theme",
      preset: samplePreset({ radius: "1rem" }),
    };
    const other = { id: "other", preset: samplePreset() };

    expect(withPersonalPreset([first, other], replacement)).toEqual([
      other,
      replacement,
    ]);
  });
});

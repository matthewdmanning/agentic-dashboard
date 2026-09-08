import { describe, expect, test } from "vitest";

import {
  compositionNodeSchema,
  integrationSchema,
  compileCardMapper,
  mutationSchema,
  namedPresetSchema,
  parseDashboardConfiguration,
  presetSchema,
  presetTokens,
  userAppearanceSchema,
  type CardMapperSpec,
  type DashboardConfiguration,
  type Preset,
} from "./index";
import {
  useTestCardTemplates,
  withTestCard,
} from "../test-support/card-template";

const configuration: DashboardConfiguration = {
  integrations: [
    {
      id: "calendar",
      type: "google-calendar",
      settings: { calendarId: "team" },
    },
  ],
  themes: [{ id: "calm", settings: { density: "comfortable" } }],
  presets: [],
  dashboard: { id: "home", cards: ["first", "second"], theme: "calm" },
  cards: [
    {
      id: "first",
      title: "First",
      template: "message",
      state: { message: "First message" },
    },
    {
      id: "second",
      title: "Second",
      template: "calendar",
      state: { events: [] },
    },
  ],
  cardMappers: [],
  integrationRetentionDays: 30,
};

describe("dashboard contract", () => {
  useTestCardTemplates();

  test("parses the settled configuration shape", () => {
    expect(parseDashboardConfiguration(configuration)).toEqual(configuration);
  });

  test("rejects removed version, wiring, and arrangement fields", () => {
    expect(() =>
      parseDashboardConfiguration({
        ...configuration,
        version: 1,
        wiring: [],
        arrangement: [],
      }),
    ).toThrow();
  });

  test("rejects fontScale (#95) — typeset size, a per-user field, replaces it", () => {
    expect(() =>
      parseDashboardConfiguration({ ...configuration, fontScale: 1.1 }),
    ).toThrow();
  });

  test("rejects dangling dashboard references", () => {
    expect(() =>
      parseDashboardConfiguration({
        ...configuration,
        dashboard: { id: "home", cards: ["missing"], theme: "calm" },
      }),
    ).toThrow("unknown card");
  });

  test("rejects card state that does not fit its card template", () => {
    expect(() =>
      parseDashboardConfiguration({
        ...configuration,
        cards: [
          { ...configuration.cards[0], state: { message: 42 } },
          configuration.cards[1],
        ],
      }),
    ).toThrow("does not fit card template 'message'");
  });

  test("rejects a card naming an unknown card template", () => {
    expect(() =>
      parseDashboardConfiguration({
        ...configuration,
        cards: [
          { ...configuration.cards[0], template: "nonexistent" },
          configuration.cards[1],
        ],
      }),
    ).toThrow();
  });
});

describe("compositionNodeSchema", () => {
  test("parses a recursive tree naming any component and props", () => {
    expect(
      compositionNodeSchema.parse({
        component: "GridList",
        props: { "aria-label": "Do" },
        children: [
          {
            component: "GridListItem",
            props: { textValue: "Fix outage" },
            children: [],
          },
        ],
      }),
    ).toEqual({
      component: "GridList",
      props: { "aria-label": "Do" },
      children: [
        {
          component: "GridListItem",
          props: { textValue: "Fix outage" },
          children: [],
        },
      ],
    });
  });

  test("rejects a node missing the structural shape", () => {
    expect(() => compositionNodeSchema.parse({ component: "Text" })).toThrow();
  });
});

describe("assemble-card-template mutation", () => {
  test("parses given a name, a JSON Schema, and a composition tree", () => {
    expect(
      mutationSchema.parse({
        type: "assemble-card-template",
        template: "eisenhower",
        jsonSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        composition: { component: "Flex", props: {}, children: [] },
      }),
    ).toMatchObject({ type: "assemble-card-template" });
  });

  test("rejects a missing JSON Schema", () => {
    expect(() =>
      mutationSchema.parse({
        type: "assemble-card-template",
        template: "eisenhower",
        composition: { component: "Flex", props: {}, children: [] },
      }),
    ).toThrow();
  });
});

describe("card mapper mutations", () => {
  test("parse a name and a declarative spec", () => {
    const spec: CardMapperSpec = { shape: "object", fields: {} };
    expect(
      mutationSchema.parse({ type: "add-card-mapper", name: "events", spec }),
    ).toMatchObject({ type: "add-card-mapper", name: "events" });
    expect(
      mutationSchema.parse({ type: "edit-card-mapper", name: "events", spec }),
    ).toMatchObject({ type: "edit-card-mapper", name: "events" });
    expect(
      mutationSchema.parse({ type: "remove-card-mapper", name: "events" }),
    ).toMatchObject({ type: "remove-card-mapper", name: "events" });
  });
});

describe("integration settings", () => {
  test("refuse a credential-shaped key, whatever it is called", () => {
    for (const key of ["apiKey", "access_token", "clientSecret", "password"]) {
      expect(() =>
        integrationSchema.parse({
          id: "connection",
          type: "example-service",
          settings: { [key]: "value" },
        }),
      ).toThrow();
    }

    expect(() =>
      integrationSchema.parse({
        id: "connection",
        type: "example-service",
        settings: { region: "eu" },
      }),
    ).not.toThrow();

    expect(() =>
      integrationSchema.parse({
        id: "connection",
        type: "example-service",
        settings: { metadata: { accessToken: "not-allowed" } },
      }),
    ).toThrow();
  });
});

describe("user appearance (#94, #95)", () => {
  const validAppearance = {
    baseColour: "slate",
    typeset: {
      size: 1,
      leading: "normal",
      flow: "wrap",
      bodyFont: "sans",
      headingFont: "sans",
      monospaceFont: "mono",
    },
    menuColour: "default",
    menuAccent: "subtle",
    personalPresets: [],
  };

  test("parses a complete, closed-vocabulary appearance", () => {
    expect(userAppearanceSchema.parse(validAppearance)).toEqual(
      validAppearance,
    );
  });

  test("rejects a base colour outside shadcn's vocabulary", () => {
    expect(() =>
      userAppearanceSchema.parse({ ...validAppearance, baseColour: "purple" }),
    ).toThrow();
  });

  test("rejects an unsupported menu colour", () => {
    expect(() =>
      userAppearanceSchema.parse({
        ...validAppearance,
        menuColour: "rainbow",
      }),
    ).toThrow();
  });

  test("rejects an unsupported menu accent", () => {
    expect(() =>
      userAppearanceSchema.parse({ ...validAppearance, menuAccent: "loud" }),
    ).toThrow();
  });

  test("rejects an unsupported typeset leading, flow, or font family", () => {
    expect(() =>
      userAppearanceSchema.parse({
        ...validAppearance,
        typeset: { ...validAppearance.typeset, leading: "condensed" },
      }),
    ).toThrow();
    expect(() =>
      userAppearanceSchema.parse({
        ...validAppearance,
        typeset: { ...validAppearance.typeset, flow: "nowrap" },
      }),
    ).toThrow();
    expect(() =>
      userAppearanceSchema.parse({
        ...validAppearance,
        typeset: { ...validAppearance.typeset, bodyFont: "comic-sans" },
      }),
    ).toThrow();
  });

  test("rejects a project-owned field smuggled onto a user's appearance", () => {
    expect(() =>
      userAppearanceSchema.parse({ ...validAppearance, iconLibrary: "lucide" }),
    ).toThrow();
  });

  test("accepts a selected preset, and rejects clearing it via anything but null", () => {
    expect(
      userAppearanceSchema.parse({
        ...validAppearance,
        selectedPreset: { source: "personal", id: "my-theme" },
      }),
    ).toMatchObject({ selectedPreset: { source: "personal", id: "my-theme" } });

    expect(() =>
      userAppearanceSchema.parse({
        ...validAppearance,
        selectedPreset: { source: "cloud", id: "my-theme" },
      }),
    ).toThrow();
  });
});

describe("presets (#96)", () => {
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

  test("parses a complete token set", () => {
    expect(presetSchema.parse(samplePreset())).toEqual(samplePreset());
  });

  test("rejects a partial preset missing the dark block", () => {
    const { dark, ...partial } = samplePreset();
    expect(() => presetSchema.parse(partial)).toThrow();
  });

  test("rejects a partial preset missing a single token from a complete block", () => {
    const preset = samplePreset();
    const { background, ...incompleteLight } = preset.light;
    expect(() =>
      presetSchema.parse({ ...preset, light: incompleteLight }),
    ).toThrow();
  });

  test("rejects arbitrary CSS smuggled through a token value", () => {
    const preset = samplePreset();
    for (const payload of [
      "red; } * { display: none",
      "url(javascript:alert(1))",
      "<style>",
      "/* comment */ red",
    ]) {
      expect(() =>
        presetSchema.parse({
          ...preset,
          light: { ...preset.light, background: payload },
        }),
      ).toThrow();
    }
  });

  test("rejects a base-rules bundle outside the one supported identifier", () => {
    expect(() =>
      presetSchema.parse({ ...samplePreset(), baseRules: "custom" }),
    ).toThrow();
  });

  test("a named preset requires an id alongside the complete token set", () => {
    expect(
      namedPresetSchema.parse({ id: "midnight", preset: samplePreset() }),
    ).toMatchObject({ id: "midnight" });
    expect(() => namedPresetSchema.parse({ preset: samplePreset() })).toThrow();
  });
});

describe("compileCardMapper", () => {
  test("maps object fields with fallback, default, and coercion", () => {
    const spec: CardMapperSpec = {
      shape: "object",
      fields: {
        title: { from: ["summary", "title"], default: "Untitled" },
        temperature: { from: ["temp"], coerce: "string" },
      },
    };

    expect(compileCardMapper(spec)({ summary: "Standup", temp: 72 })).toEqual({
      title: "Standup",
      temperature: "72",
    });
  });

  test("maps arrays and substitutes the item index in defaults", () => {
    const spec: CardMapperSpec = {
      shape: "array",
      from: ["items"],
      into: "events",
      fields: {
        id: { from: ["id"], default: "event-$index", coerce: "string" },
      },
    };

    expect(compileCardMapper(spec)({ items: [{}, { id: "x" }] })).toEqual({
      events: [{ id: "event-0" }, { id: "x" }],
    });
  });
});

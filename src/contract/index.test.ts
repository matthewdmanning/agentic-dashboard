import { describe, expect, test } from "vitest";

import {
  compositionNodeSchema,
  integrationSchema,
  compileCardMapper,
  mutationSchema,
  parseDashboardConfiguration,
  type CardMapperSpec,
  type DashboardConfiguration,
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
  dashboard: { id: "home", cards: ["first", "second"], theme: "calm" },
  fontScale: 1.1,
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
        { component: "GridListItem", props: { textValue: "Fix outage" }, children: [] },
      ],
    });
  });

  test("rejects a node missing the structural shape", () => {
    expect(() =>
      compositionNodeSchema.parse({ component: "Text" }),
    ).toThrow();
  });
});

describe("assemble-card-template mutation", () => {
  test("parses given a name, a JSON Schema, and a composition tree", () => {
    expect(
      mutationSchema.parse({
        type: "assemble-card-template",
        template: "eisenhower",
        jsonSchema: { type: "object", properties: {}, additionalProperties: false },
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

describe("compileCardMapper", () => {
  test("maps object fields with fallback, default, and coercion", () => {
    const spec: CardMapperSpec = {
      shape: "object",
      fields: {
        title: { from: ["summary", "title"], default: "Untitled" },
        temperature: { from: ["temp"], coerce: "string" },
      },
    };

    expect(
      compileCardMapper(spec)({ summary: "Standup", temp: 72 }),
    ).toEqual({ title: "Standup", temperature: "72" });
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

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  defaultDashboardConfiguration,
  defaultUserAppearance,
  type Mutation,
} from "../contract";
import { Settings } from "./Settings";

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

/** The markup of one fieldset, so a control elsewhere cannot satisfy the test. */
function fieldset(html: string, legend: string): string {
  const start = html.indexOf(`<legend>${legend}</legend>`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</fieldset>", start));
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

    expect(appearance).toContain('value="slate" selected');
    expect(appearance).toContain(">neutral<");
    expect(appearance).toContain(">gray<");
    expect(appearance).toContain(">zinc<");
    expect(appearance).toContain(">stone<");
    expect(appearance).toContain(">slate<");
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

    expect(appearance).toContain('value="relaxed" selected');
    expect(appearance).toContain('value="balance" selected');
    expect(appearance).toContain('value="serif" selected');
    expect(appearance).toContain('value="mono" selected');
    expect(appearance).toContain('value="sans" selected');
    expect(appearance).toContain('value="inverted" selected');
    expect(appearance).toContain('value="bold" selected');
    expect(appearance).not.toContain("Font scale");
  });
});

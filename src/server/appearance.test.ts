import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { encodeUserPathSegment } from "../auth";
import {
  baseColours,
  defaultUserAppearance,
  menuAccents,
  menuColours,
  presetTokens,
  type NamedPreset,
  type UserAppearance,
} from "../contract";
import {
  appearanceCss,
  createFileAppearanceStore,
  generateUserComponentsConfig,
  readComponentsTemplate,
  writeUserComponentsConfig,
} from "./appearance";

function appearance(overrides: Partial<UserAppearance> = {}): UserAppearance {
  return { ...defaultUserAppearance, ...overrides };
}

describe("readComponentsTemplate (D33)", () => {
  test("strips the user-owned fields a components.json on disk still carries", () => {
    const template = readComponentsTemplate({
      style: "new-york",
      rsc: false,
      tsx: true,
      tailwind: {
        config: "",
        css: "src/styles.css",
        cssVariables: true,
        prefix: "",
        baseColor: "neutral",
      },
      iconLibrary: "lucide",
      rtl: false,
      aliases: { components: "@/components", utils: "@/lib/utils" },
      menuColor: "default",
      menuAccent: "subtle",
    });

    expect(template).not.toHaveProperty("menuColor");
    expect(template).not.toHaveProperty("menuAccent");
    expect(template.tailwind).not.toHaveProperty("baseColor");
    expect(template.style).toBe("new-york");
  });
});

describe("generateUserComponentsConfig (D34, #95)", () => {
  test("overlays base colour and menu fields, replacing the config as a whole", () => {
    const template = readComponentsTemplate({
      style: "new-york",
      rsc: false,
      tsx: true,
      tailwind: {
        config: "",
        css: "src/styles.css",
        cssVariables: true,
        prefix: "",
      },
      iconLibrary: "lucide",
      rtl: false,
      aliases: {},
    });

    const config = generateUserComponentsConfig(
      template,
      appearance({
        baseColour: "zinc",
        menuColour: "inverted",
        menuAccent: "bold",
      }),
    );

    expect(config).toMatchObject({
      style: "new-york",
      iconLibrary: "lucide",
      tailwind: { cssVariables: true, baseColor: "zinc" },
      menuColor: "inverted",
      menuAccent: "bold",
    });
  });
});

describe("writeUserComponentsConfig (D34, #94)", () => {
  test("regenerates the whole file, so a later appearance never leaves a stale field behind", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "components-"));
    const templatePath = join(workspace, "components.json");
    const componentsDir = join(workspace, "components");
    await writeFile(
      templatePath,
      JSON.stringify({
        style: "new-york",
        rsc: false,
        tsx: true,
        tailwind: {
          config: "",
          css: "src/styles.css",
          cssVariables: true,
          prefix: "",
        },
        iconLibrary: "lucide",
        rtl: false,
        aliases: {},
      }),
    );

    await writeUserComponentsConfig(
      componentsDir,
      templatePath,
      "alice",
      appearance({ baseColour: "slate" }),
    );
    await writeUserComponentsConfig(
      componentsDir,
      templatePath,
      "alice",
      appearance({ baseColour: "stone" }),
    );

    const generated = JSON.parse(
      await readFile(
        join(componentsDir, `${encodeUserPathSegment("alice")}.json`),
        "utf8",
      ),
    ) as { tailwind: { baseColor: string } };
    expect(generated.tailwind.baseColor).toBe("stone");
  });

  test("an identity carrying path separators still writes one file inside the directory", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "components-"));
    const templatePath = join(workspace, "components.json");
    const componentsDir = join(workspace, "components");
    await writeFile(
      templatePath,
      JSON.stringify({
        style: "new-york",
        rsc: false,
        tsx: true,
        tailwind: {
          config: "",
          css: "src/styles.css",
          cssVariables: true,
          prefix: "",
        },
        iconLibrary: "lucide",
        rtl: false,
        aliases: {},
      }),
    );

    await writeUserComponentsConfig(
      componentsDir,
      templatePath,
      "../../escaped",
      appearance({ baseColour: "slate" }),
    );

    // Everything the directory holds is one encoded segment, so nothing was
    // written beside or above it.
    expect(await readdir(componentsDir)).toEqual([
      `${encodeUserPathSegment("../../escaped")}.json`,
    ]);
    expect(await readdir(workspace)).toEqual(["components", "components.json"]);
  });
});

/** The custom properties one selector's first block declares, as `{ token: value }`. */
function declarationsIn(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].replace(/\s+/g, " ").trim(),
    ]),
  );
}

/** Every `--menu-*` declaration anywhere in the stylesheet, as `{ token: value }` — the menu block is emitted once, so unlike `declarationsIn` there is no selector ambiguity to resolve. */
function menuDeclarations(css: string): Record<string, string> {
  return Object.fromEntries(
    [...css.matchAll(/--menu-([\w-]+):\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].trim(),
    ]),
  );
}

/** A minimal but complete preset (#96), every token filled with the same placeholder value so a test can assert on shape rather than colour. */
function samplePreset(fill: string): NamedPreset {
  return {
    id: "sample",
    preset: {
      themeMapping: {},
      light: Object.fromEntries(
        presetTokens.map((token) => [token, fill]),
      ) as never,
      dark: Object.fromEntries(
        presetTokens.map((token) => [token, fill]),
      ) as never,
      radius: "0.5rem",
      baseRules: "default",
    },
  };
}

describe("appearanceCss (D26, #95)", () => {
  test("the neutral base colour reproduces styles.css token for token, light and dark", async () => {
    // `styles.css` is the project's own neutral stylesheet, so generating
    // `neutral` must land on exactly it. This is what pins the palette and the
    // token-to-step mapping to something real instead of eyeballed values, and
    // what catches the two drifting apart later.
    const stylesheet = await readFile(
      new URL("../styles.css", import.meta.url),
      "utf8",
    );
    const generated = appearanceCss(appearance({ baseColour: "neutral" }));

    const expectedLight = declarationsIn(stylesheet, ":root");
    const expectedDark = declarationsIn(stylesheet, ".dark");
    const actualLight = declarationsIn(generated, ":root");
    const actualDark = declarationsIn(generated, ".dark");

    for (const token of presetTokens) {
      expect({ token, value: actualLight[token] }).toEqual({
        token,
        value: expectedLight[token],
      });
      expect({ token, value: actualDark[token] }).toEqual({
        token,
        value: expectedDark[token],
      });
    }
  });

  test("every base colour covers every token in both modes", () => {
    for (const baseColour of baseColours) {
      const css = appearanceCss(appearance({ baseColour }));
      const light = declarationsIn(css, ":root");
      const dark = declarationsIn(css, ".dark");
      for (const token of presetTokens) {
        expect(light[token]).toBeTruthy();
        expect(dark[token]).toBeTruthy();
      }
    }
  });

  test("the dark block follows the light one, so it wins wherever the class is active", () => {
    const css = appearanceCss(appearance({ baseColour: "slate" }));
    expect(css.indexOf(".dark {")).toBeGreaterThan(css.indexOf(":root {"));
  });

  test("every base colour produces a distinct, non-empty stylesheet", () => {
    const colours = ["neutral", "gray", "zinc", "stone", "slate"] as const;
    const stylesheets = colours.map((baseColour) =>
      appearanceCss(appearance({ baseColour })),
    );

    for (const css of stylesheets) {
      expect(css).toContain(":root {");
      expect(css).toContain("--background");
      expect(css).toContain("--primary");
    }
    expect(new Set(stylesheets).size).toBe(colours.length);
  });

  test("applies the typeset to the dashboard root, not a card template", () => {
    const css = appearanceCss(
      appearance({
        typeset: {
          size: 1.25,
          leading: "relaxed",
          flow: "balance",
          bodyFont: "serif",
          headingFont: "mono",
          monospaceFont: "sans",
        },
      }),
    );

    expect(css).toContain("main {");
    expect(css).toContain("calc(1rem * 1.25)");
    expect(css).toContain("line-height: 1.625");
    expect(css).toContain("text-wrap: balance");

    // Fonts arrive as the custom properties `styles.css` maps its `@theme
    // inline` font tokens onto, so a component carrying a font utility of its
    // own (`CardTitle`'s `font-heading`) follows the viewing user too — a
    // `font-family` rule on `main` only ever reached inherited text.
    expect(css).toContain("--body-font: ui-serif");
    expect(css).toContain("--heading-font: ui-monospace");
    expect(css).toContain("--monospace-font: ui-sans-serif");
    expect(css).not.toContain("main :is(h1");
  });

  test("every menuColour value produces distinct menu tokens (#109)", () => {
    const stylesheets = menuColours.map((menuColour) =>
      appearanceCss(appearance({ menuColour })),
    );

    for (const css of stylesheets) {
      const menu = menuDeclarations(css);
      expect(menu.background).toBeTruthy();
      expect(menu.foreground).toBeTruthy();
    }
    expect(
      new Set(stylesheets.map((css) => menuDeclarations(css).background)).size,
    ).toBe(menuColours.length);
  });

  test("every menuAccent value produces distinct menu tokens (#109)", () => {
    const stylesheets = menuAccents.map((menuAccent) =>
      appearanceCss(appearance({ menuAccent })),
    );

    for (const css of stylesheets) {
      expect(menuDeclarations(css).accent).toBeTruthy();
    }
    expect(
      new Set(stylesheets.map((css) => menuDeclarations(css).accent)).size,
    ).toBe(menuAccents.length);
  });

  test("menu tokens appear on both the preset path and the base-colour path (#109)", () => {
    const baseColourStylesheet = appearanceCss(
      appearance({ baseColour: "slate" }),
    );
    expect(menuDeclarations(baseColourStylesheet).background).toBeTruthy();
    // The base-colour path never sets `--radius` (only a preset's `radius`
    // reaches `tokenSetCss`) — its absence here is what proves this
    // assertion actually observed the base-colour path.
    expect(baseColourStylesheet).not.toContain("--radius:");

    const preset = samplePreset("oklch(0.5 0 0)");
    const presetStylesheet = appearanceCss(
      appearance({ selectedPreset: { source: "server", id: preset.id } }),
      [preset],
    );
    expect(menuDeclarations(presetStylesheet).background).toBeTruthy();
    // `resolveSelectedPreset` silently falls through to the base-colour path
    // on any resolution miss, so a `--menu-background` present here isn't by
    // itself proof the preset path ran — pin it to the preset's own radius,
    // which only the preset path emits.
    expect(presetStylesheet).toContain("--radius: 0.5rem");
  });

  test("no menuColour/menuAccent combination emits a hex literal (#109, ARCHITECTURE.md:95)", () => {
    for (const menuColour of menuColours) {
      for (const menuAccent of menuAccents) {
        const css = appearanceCss(appearance({ menuColour, menuAccent }));
        const menu = menuDeclarations(css);
        for (const value of Object.values(menu)) {
          expect(value).not.toMatch(/#[0-9a-fA-F]{3,8}/);
        }
      }
    }
  });
});

describe("createFileAppearanceStore (D33-D35)", () => {
  test("persists one user's preference across store instances built from the same path", async () => {
    const path = join(
      await mkdtemp(join(tmpdir(), "appearance-")),
      "appearance.json",
    );

    await createFileAppearanceStore(path).set(
      "alice",
      appearance({ baseColour: "gray" }),
    );

    await expect(createFileAppearanceStore(path).get("alice")).resolves.toEqual(
      appearance({ baseColour: "gray" }),
    );
  });

  test("returns undefined for a user who never set a preference", async () => {
    const path = join(
      await mkdtemp(join(tmpdir(), "appearance-")),
      "appearance.json",
    );

    await expect(
      createFileAppearanceStore(path).get("nobody"),
    ).resolves.toBeUndefined();
  });
});

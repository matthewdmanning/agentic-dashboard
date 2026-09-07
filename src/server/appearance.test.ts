import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { defaultUserAppearance, type UserAppearance } from "../contract";
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
      await readFile(join(componentsDir, "alice.json"), "utf8"),
    ) as { tailwind: { baseColor: string } };
    expect(generated.tailwind.baseColor).toBe("stone");
  });
});

describe("appearanceCss (D26, #95)", () => {
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
    expect(css).toContain("ui-serif");
    expect(css).toContain("main :is(h1, h2, h3, h4, h5, h6)");
    expect(css).toContain("ui-monospace");
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

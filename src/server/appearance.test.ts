import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  appearanceCss,
  createFileAppearanceStore,
  generateUserComponentsConfig,
  readComponentsTemplate,
  writeUserComponentsConfig,
} from "./appearance";

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

describe("generateUserComponentsConfig (D34)", () => {
  test("overlays only the user's base colour, replacing the config as a whole", () => {
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

    const config = generateUserComponentsConfig(template, {
      baseColour: "zinc",
    });

    expect(config).toMatchObject({
      style: "new-york",
      iconLibrary: "lucide",
      tailwind: { cssVariables: true, baseColor: "zinc" },
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

    await writeUserComponentsConfig(componentsDir, templatePath, "alice", {
      baseColour: "slate",
    });
    await writeUserComponentsConfig(componentsDir, templatePath, "alice", {
      baseColour: "stone",
    });

    const generated = JSON.parse(
      await readFile(join(componentsDir, "alice.json"), "utf8"),
    ) as { tailwind: { baseColor: string } };
    expect(generated.tailwind.baseColor).toBe("stone");
  });
});

describe("appearanceCss (D26)", () => {
  test("every base colour produces a distinct, non-empty stylesheet", () => {
    const colours = ["neutral", "gray", "zinc", "stone", "slate"] as const;
    const stylesheets = colours.map(appearanceCss);

    for (const css of stylesheets) {
      expect(css).toContain(":root {");
      expect(css).toContain("--background");
      expect(css).toContain("--primary");
    }
    expect(new Set(stylesheets).size).toBe(colours.length);
  });
});

describe("createFileAppearanceStore (D33-D35)", () => {
  test("persists one user's preference across store instances built from the same path", async () => {
    const path = join(
      await mkdtemp(join(tmpdir(), "appearance-")),
      "appearance.json",
    );

    await createFileAppearanceStore(path).set("alice", { baseColour: "gray" });

    await expect(createFileAppearanceStore(path).get("alice")).resolves.toEqual(
      { baseColour: "gray" },
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

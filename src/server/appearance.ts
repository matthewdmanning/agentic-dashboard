import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as z from "zod/v4";

import {
  userAppearanceSchema,
  type BaseColour,
  type Typeset,
  type TypesetFontFamily,
  type UserAppearance,
} from "../contract";

async function writeJson(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

// ---- per-user appearance store (D33-D35) ----

const storedAppearanceSchema = z
  .object({ user: z.string().min(1), appearance: userAppearanceSchema })
  .strict();

type StoredAppearance = z.infer<typeof storedAppearanceSchema>;

async function readRecords(path: string): Promise<StoredAppearance[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed)) {
      throw new Error("Appearance store must be an array");
    }
    return parsed.map((entry) => storedAppearanceSchema.parse(entry));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return [];
  }
}

export interface AppearanceStore {
  get(user: string): Promise<UserAppearance | undefined>;
  set(user: string, appearance: UserAppearance): Promise<void>;
}

/** One file for every user's appearance preference (D33-D35), the same shape as `connections.ts` and `queries.ts` — a cleartext envelope, nothing here is secret. */
export function createFileAppearanceStore(path: string): AppearanceStore {
  return {
    async get(user) {
      const records = await readRecords(path);
      return records.find((record) => record.user === user)?.appearance;
    },
    async set(user, appearance) {
      const records = await readRecords(path);
      const index = records.findIndex((record) => record.user === user);
      const record: StoredAppearance = { user, appearance };
      if (index === -1) {
        records.push(record);
      } else {
        records[index] = record;
      }
      await writeJson(path, records);
    },
  };
}

// ---- project template / per-user components.json (D33, D34) ----

/**
 * Every field shadcn's `components.json` defines that stays project-owned
 * (D33): everything except the user-owned runtime fields (`tailwind.baseColor`,
 * `menuColor`, `menuAccent`) that a viewing user's own appearance always
 * supplies instead.
 */
export const componentsTemplateSchema = z
  .object({
    $schema: z.string().optional(),
    style: z.string(),
    rsc: z.boolean(),
    tsx: z.boolean(),
    tailwind: z
      .object({
        config: z.string(),
        css: z.string(),
        cssVariables: z.boolean(),
        prefix: z.string(),
      })
      .strict(),
    iconLibrary: z.string(),
    rtl: z.boolean(),
    aliases: z.record(z.string(), z.string()),
    registries: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ComponentsTemplate = z.infer<typeof componentsTemplateSchema>;

/**
 * Strips the known user-owned fields before validating, so the project's own
 * `components.json` — which also carries today's default user-owned values —
 * can serve as the template without those fields tripping `.strict()`.
 */
export function readComponentsTemplate(raw: unknown): ComponentsTemplate {
  const { menuColor, menuAccent, tailwind, ...rest } = raw as Record<
    string,
    unknown
  >;
  const { baseColor, ...tailwindRest } = (tailwind ?? {}) as Record<
    string,
    unknown
  >;
  return componentsTemplateSchema.parse({ ...rest, tailwind: tailwindRest });
}

/**
 * Overlays a user's runtime choices onto the project template (D34) —
 * replacing the effective config as a whole. No project-owned field can
 * survive here since `UserAppearance` never carries one.
 */
export function generateUserComponentsConfig(
  template: ComponentsTemplate,
  appearance: UserAppearance,
): Record<string, unknown> {
  return {
    ...template,
    tailwind: { ...template.tailwind, baseColor: appearance.baseColour },
    menuColor: appearance.menuColour,
    menuAccent: appearance.menuAccent,
  };
}

/**
 * Regenerates one user's effective `components.json` under `componentsDir`
 * whenever their appearance changes (D34) — the whole file, every time,
 * never a patch, so no stale or project-owned field can survive a
 * regeneration.
 */
export async function writeUserComponentsConfig(
  componentsDir: string,
  templatePath: string,
  user: string,
  appearance: UserAppearance,
): Promise<void> {
  const template = readComponentsTemplate(
    JSON.parse(await readFile(templatePath, "utf8")),
  );
  await writeJson(
    join(componentsDir, `${user}.json`),
    generateUserComponentsConfig(template, appearance),
  );
}

// ---- semantic colour tokens (D26) ----

/**
 * One representative semantic-token block per shadcn base colour. Real,
 * distinct values per colour — not a claim of matching the shadcn CLI's own
 * generator token-for-token, which D26 already rules out re-running per user.
 * Token names match the CSS custom properties `styles.css` already declares,
 * so a card template that only ever names a semantic token recolours under
 * whichever block is in effect without any change of its own.
 */
const baseColourTokenValues: Record<BaseColour, Record<string, string>> = {
  neutral: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    card: "oklch(1 0 0)",
    primary: "oklch(0.205 0 0)",
    "primary-foreground": "oklch(0.985 0 0)",
    secondary: "oklch(0.97 0 0)",
    muted: "oklch(0.97 0 0)",
    "muted-foreground": "oklch(0.556 0 0)",
    accent: "oklch(0.97 0 0)",
    border: "oklch(0.922 0 0)",
    ring: "oklch(0.708 0 0)",
  },
  gray: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.15 0.02 265)",
    card: "oklch(1 0 0)",
    primary: "oklch(0.21 0.03 265)",
    "primary-foreground": "oklch(0.985 0 0)",
    secondary: "oklch(0.96 0.01 265)",
    muted: "oklch(0.96 0.01 265)",
    "muted-foreground": "oklch(0.55 0.02 265)",
    accent: "oklch(0.96 0.01 265)",
    border: "oklch(0.92 0.01 265)",
    ring: "oklch(0.71 0.02 265)",
  },
  zinc: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.14 0.005 285)",
    card: "oklch(1 0 0)",
    primary: "oklch(0.21 0.006 285)",
    "primary-foreground": "oklch(0.985 0 0)",
    secondary: "oklch(0.967 0.001 286)",
    muted: "oklch(0.967 0.001 286)",
    "muted-foreground": "oklch(0.552 0.014 285)",
    accent: "oklch(0.967 0.001 286)",
    border: "oklch(0.92 0.004 286)",
    ring: "oklch(0.705 0.015 286)",
  },
  stone: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.147 0.004 49)",
    card: "oklch(1 0 0)",
    primary: "oklch(0.216 0.006 56)",
    "primary-foreground": "oklch(0.985 0.001 106)",
    secondary: "oklch(0.97 0.001 106)",
    muted: "oklch(0.97 0.001 106)",
    "muted-foreground": "oklch(0.553 0.013 58)",
    accent: "oklch(0.97 0.001 106)",
    border: "oklch(0.923 0.003 48)",
    ring: "oklch(0.709 0.01 56)",
  },
  slate: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.129 0.042 264)",
    card: "oklch(1 0 0)",
    primary: "oklch(0.208 0.042 265)",
    "primary-foreground": "oklch(0.984 0.003 247)",
    secondary: "oklch(0.968 0.007 247)",
    muted: "oklch(0.968 0.007 247)",
    "muted-foreground": "oklch(0.554 0.046 257)",
    accent: "oklch(0.968 0.007 247)",
    border: "oklch(0.929 0.013 255)",
    ring: "oklch(0.704 0.04 256)",
  },
};

/** Tailwind's `leading-*` scale, as real numeric line-height values (#95). */
const typesetLeadingValues: Record<Typeset["leading"], string> = {
  tight: "1.25",
  normal: "1.5",
  relaxed: "1.625",
};

/**
 * A generic font-family token's real stack (#95) — never a webfont name this
 * project doesn't bundle, so a token always resolves to something real
 * without a new dependency.
 */
const typesetFontStacks: Record<TypesetFontFamily, string> = {
  sans: "ui-sans-serif, system-ui, sans-serif",
  serif: "ui-serif, Georgia, serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

/**
 * The viewing user's effective stylesheet (D26, #95): a `:root` block naming
 * only semantic colour tokens `styles.css` already declares, plus a `main`
 * rule applying their typeset — the same dashboard root every card renders
 * under, so one rule covers all of them without a card template naming a
 * font or size of its own. Computed fresh from the stored appearance every
 * time, never cached, so no stale value can survive a change.
 *
 * ponytail: `menuColour`/`menuAccent` are stored and generated into the
 * user's `components.json` but have no CSS rule here yet — this codebase has
 * no menu-shaped card template to style. Add the rule once one exists.
 */
export function appearanceCss(appearance: UserAppearance): string {
  const colourDeclarations = Object.entries(
    baseColourTokenValues[appearance.baseColour],
  )
    .map(([token, value]) => `  --${token}: ${value};`)
    .join("\n");
  const { typeset } = appearance;
  return `:root {
${colourDeclarations}
}

main {
  font-size: calc(1rem * ${typeset.size});
  line-height: ${typesetLeadingValues[typeset.leading]};
  text-wrap: ${typeset.flow};
  font-family: ${typesetFontStacks[typeset.bodyFont]};
}

main :is(h1, h2, h3, h4, h5, h6) {
  font-family: ${typesetFontStacks[typeset.headingFont]};
}

main :is(code, pre, kbd, samp) {
  font-family: ${typesetFontStacks[typeset.monospaceFont]};
}
`;
}

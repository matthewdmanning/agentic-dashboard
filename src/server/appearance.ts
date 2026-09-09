import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import * as z from "zod/v4";

import {
  userAppearanceSchema,
  type BaseColour,
  type MenuAccent,
  type MenuColour,
  type NamedPreset,
  type Preset,
  type TokenBlock,
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

// ---- semantic colour tokens (D26) ----

/**
 * The Tailwind colour scales shadcn's base colours name (D26), at the steps
 * its token sets draw from — copied from the installed `tailwindcss`
 * package's own `theme.css` and normalised to the `oklch(L C H)` form
 * `styles.css` already uses, rather than eyeballed. This is the palette, not
 * the token set: `lightTokens`/`darkTokens` below are what turn a scale into
 * the semantic tokens a card template actually names.
 */
type PaletteStep =
  | 50
  | 100
  | 200
  | 300
  | 400
  | 500
  | 600
  | 700
  | 800
  | 900
  | 950;

const basePalette: Record<BaseColour, Record<PaletteStep, string>> = {
  neutral: {
    50: "oklch(0.985 0 0)",
    100: "oklch(0.97 0 0)",
    200: "oklch(0.922 0 0)",
    300: "oklch(0.87 0 0)",
    400: "oklch(0.708 0 0)",
    500: "oklch(0.556 0 0)",
    600: "oklch(0.439 0 0)",
    700: "oklch(0.371 0 0)",
    800: "oklch(0.269 0 0)",
    900: "oklch(0.205 0 0)",
    950: "oklch(0.145 0 0)",
  },
  gray: {
    50: "oklch(0.985 0.002 247.839)",
    100: "oklch(0.967 0.003 264.542)",
    200: "oklch(0.928 0.006 264.531)",
    300: "oklch(0.872 0.01 258.338)",
    400: "oklch(0.707 0.022 261.325)",
    500: "oklch(0.551 0.027 264.364)",
    600: "oklch(0.446 0.03 256.802)",
    700: "oklch(0.373 0.034 259.733)",
    800: "oklch(0.278 0.033 256.848)",
    900: "oklch(0.21 0.034 264.665)",
    950: "oklch(0.13 0.028 261.692)",
  },
  zinc: {
    50: "oklch(0.985 0 0)",
    100: "oklch(0.967 0.001 286.375)",
    200: "oklch(0.92 0.004 286.32)",
    300: "oklch(0.871 0.006 286.286)",
    400: "oklch(0.705 0.015 286.067)",
    500: "oklch(0.552 0.016 285.938)",
    600: "oklch(0.442 0.017 285.786)",
    700: "oklch(0.37 0.013 285.805)",
    800: "oklch(0.274 0.006 286.033)",
    900: "oklch(0.21 0.006 285.885)",
    950: "oklch(0.141 0.005 285.823)",
  },
  stone: {
    50: "oklch(0.985 0.001 106.423)",
    100: "oklch(0.97 0.001 106.424)",
    200: "oklch(0.923 0.003 48.717)",
    300: "oklch(0.869 0.005 56.366)",
    400: "oklch(0.709 0.01 56.259)",
    500: "oklch(0.553 0.013 58.071)",
    600: "oklch(0.444 0.011 73.639)",
    700: "oklch(0.374 0.01 67.558)",
    800: "oklch(0.268 0.007 34.298)",
    900: "oklch(0.216 0.006 56.043)",
    950: "oklch(0.147 0.004 49.25)",
  },
  slate: {
    50: "oklch(0.984 0.003 247.858)",
    100: "oklch(0.968 0.007 247.896)",
    200: "oklch(0.929 0.013 255.508)",
    300: "oklch(0.869 0.022 252.894)",
    400: "oklch(0.704 0.04 256.788)",
    500: "oklch(0.554 0.046 257.417)",
    600: "oklch(0.446 0.043 257.281)",
    700: "oklch(0.372 0.044 257.287)",
    800: "oklch(0.279 0.041 260.031)",
    900: "oklch(0.208 0.042 265.755)",
    950: "oklch(0.129 0.042 264.695)",
  },
};

/** Pure white, which shadcn uses directly for light surfaces rather than a scale step. */
const white = "oklch(1 0 0)";

/**
 * The tokens that do not follow the selected scale. `destructive` is always
 * red — a base colour changes the dashboard's neutrals, never the meaning of
 * a destructive action — and dark `sidebar-primary` keeps the stock shadcn
 * accent this project's `styles.css` already carries.
 */
const destructiveLight = "oklch(0.577 0.245 27.325)";
const destructiveDark = "oklch(0.704 0.191 22.216)";
const sidebarPrimaryDark = "oklch(0.488 0.243 264.376)";

/** Translucent white, so a dark border reads against whatever sits behind it rather than one assumed surface. */
const darkBorder = "oklch(1 0 0 / 10%)";
const darkInput = "oklch(1 0 0 / 15%)";

/**
 * One base colour's complete light token set (D26): every key `presetTokens`
 * names, so a base colour and a preset produce the same shape and the same
 * coverage. The step each token maps to is shadcn's own — verified by
 * generating `neutral` and checking it reproduces the `:root` block
 * `styles.css` ships, token for token.
 */
function lightTokens(scale: Record<PaletteStep, string>): TokenBlock {
  return {
    background: white,
    foreground: scale[950],
    card: white,
    "card-foreground": scale[950],
    popover: white,
    "popover-foreground": scale[950],
    primary: scale[900],
    "primary-foreground": scale[50],
    secondary: scale[100],
    "secondary-foreground": scale[900],
    muted: scale[100],
    "muted-foreground": scale[500],
    accent: scale[100],
    "accent-foreground": scale[900],
    destructive: destructiveLight,
    border: scale[200],
    input: scale[200],
    ring: scale[400],
    // Monochrome charts, drawn from the same scale — this project's own
    // choice in `styles.css`, not shadcn's stock multicolour set.
    "chart-1": scale[300],
    "chart-2": scale[500],
    "chart-3": scale[600],
    "chart-4": scale[700],
    "chart-5": scale[800],
    sidebar: scale[50],
    "sidebar-foreground": scale[950],
    "sidebar-primary": scale[900],
    "sidebar-primary-foreground": scale[50],
    "sidebar-accent": scale[100],
    "sidebar-accent-foreground": scale[900],
    "sidebar-border": scale[200],
    "sidebar-ring": scale[400],
  };
}

/** The same base colour's complete dark token set (D26) — verified the same way against `styles.css`'s `.dark` block. */
function darkTokens(scale: Record<PaletteStep, string>): TokenBlock {
  return {
    background: scale[950],
    foreground: scale[50],
    card: scale[900],
    "card-foreground": scale[50],
    popover: scale[900],
    "popover-foreground": scale[50],
    primary: scale[200],
    "primary-foreground": scale[900],
    secondary: scale[800],
    "secondary-foreground": scale[50],
    muted: scale[800],
    "muted-foreground": scale[400],
    accent: scale[800],
    "accent-foreground": scale[50],
    destructive: destructiveDark,
    border: darkBorder,
    input: darkInput,
    ring: scale[500],
    "chart-1": scale[300],
    "chart-2": scale[500],
    "chart-3": scale[600],
    "chart-4": scale[700],
    "chart-5": scale[800],
    sidebar: scale[900],
    "sidebar-foreground": scale[50],
    "sidebar-primary": sidebarPrimaryDark,
    "sidebar-primary-foreground": scale[50],
    "sidebar-accent": scale[800],
    "sidebar-accent-foreground": scale[50],
    "sidebar-border": darkBorder,
    "sidebar-ring": scale[500],
  };
}

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
 * A user's typeset (#95), in the two forms Tailwind actually reads.
 *
 * The three fonts are redefined as the custom properties `styles.css` maps
 * its `@theme inline` font tokens onto, never as `font-family` rules of our
 * own. A font utility compiles to `font-family: var(--body-font)` and lands
 * on the element itself, so it beats anything inherited from a `main` rule:
 * `CardTitle` carries `font-heading`, which is exactly the case a selector
 * rule cannot reach. Overriding the property instead means every component
 * carrying a font utility follows the viewing user without naming a font of
 * its own — the same indirection the colour tokens already rely on.
 *
 * Size, leading, and flow are not tokens, so they stay a rule on `main` —
 * the dashboard root every card renders under.
 */
function typesetCss(typeset: Typeset): string {
  return `:root {
  --body-font: ${typesetFontStacks[typeset.bodyFont]};
  --heading-font: ${typesetFontStacks[typeset.headingFont]};
  --monospace-font: ${typesetFontStacks[typeset.monospaceFont]};
}

main {
  font-size: calc(1rem * ${typeset.size});
  line-height: ${typesetLeadingValues[typeset.leading]};
  text-wrap: ${typeset.flow};
}
`;
}

/**
 * `menuColour`'s two axes (#109): which token pair the menu surface borrows,
 * and whether that pair is swapped outright (`inverted`) or blended toward
 * `transparent` on top of it (`*-translucent`). `--popover`/
 * `--popover-foreground` are the tokens shadcn already uses for a floating
 * surface, so `default` reuses them as-is; `inverted` swaps to
 * `--popover-foreground`/`--popover` so the menu reads as a strong contrast
 * band instead, mirroring how `--sidebar-primary` inverts for an active nav
 * item. The `-translucent` variants keep the same pairing but run the
 * background half through `color-mix()` toward `transparent`, so a menu can
 * sit over a card without fully masking it — every value here is a semantic
 * token or a `color-mix()` over one, never a hex literal or a palette-scale
 * utility, per ARCHITECTURE.md:95.
 */
const menuSurfaceTokens: Record<
  MenuColour,
  { background: string; foreground: string }
> = {
  default: {
    background: "var(--popover)",
    foreground: "var(--popover-foreground)",
  },
  inverted: {
    background: "var(--popover-foreground)",
    foreground: "var(--popover)",
  },
  "default-translucent": {
    background: "color-mix(in oklch, var(--popover) 85%, transparent)",
    foreground: "var(--popover-foreground)",
  },
  "inverted-translucent": {
    background:
      "color-mix(in oklch, var(--popover-foreground) 85%, transparent)",
    foreground: "var(--popover)",
  },
};

/**
 * `menuAccent`'s one axis (#109): how strongly a highlighted menu item
 * stands out. `bold` uses `--accent` at full strength, the same token a
 * selected sidebar item already uses; `subtle` blends `--accent` toward the
 * menu's own background (`--menu-background`, defined alongside it below) so
 * the highlight reads as a tint of the surface rather than a block of colour
 * dropped on top of it.
 */
const menuAccentTokens: Record<MenuAccent, string> = {
  bold: "var(--accent)",
  subtle: "color-mix(in oklch, var(--accent) 60%, var(--menu-background))",
};

/**
 * The viewing user's menu tokens (#109), composed into the cascade next to
 * `typesetCss`. Unlike a typeset value, every menu value is a `var()`
 * reference onto a token that itself differs between `:root` and `.dark`
 * (`--popover`, `--accent`, ...) — a custom property resolves `var()`
 * against the cascaded value on the *same* element it's declared on, not
 * wherever that value logically "means" light or dark. Declaring
 * `--menu-background` only once, under `:root`, would resolve it against
 * `:root`'s own `--popover` and freeze it there for every descendant,
 * including ones inside a `.dark` subtree — the exact `:root`-only mismatch
 * `tokenSetCss` already exists to avoid for the token blocks themselves. So
 * the same formula is written twice, once per selector: wherever `.dark`
 * ends up mounted, the redeclaration under it re-resolves `--menu-*` against
 * the `--popover`/`--accent` values active in that scope instead of
 * inheriting a value frozen higher up.
 */
function menuTokensCss(menuColour: MenuColour, menuAccent: MenuAccent): string {
  const surface = menuSurfaceTokens[menuColour];
  const declarations = `  --menu-background: ${surface.background};
  --menu-foreground: ${surface.foreground};
  --menu-border: var(--border);
  --menu-accent: ${menuAccentTokens[menuAccent]};
  --menu-accent-foreground: var(--accent-foreground);`;
  return `:root {
${declarations}
}

.dark {
${declarations}
}
`;
}

function tokenBlockDeclarations(block: TokenBlock): string {
  return Object.entries(block)
    .map(([token, value]) => `  --${token}: ${value};`)
    .join("\n");
}

/**
 * The viewing user's effective stylesheet from one complete token set (D26,
 * D27): a `:root` block and a `.dark` block, plus their typeset. Both the
 * base-colour and the preset path produce a full light/dark pair, so both
 * emit through here — a base colour that only redefined `:root` would leave
 * `styles.css`'s `.dark` block in force for its own tokens while overriding
 * it for the light ones, which is the mismatch that made dark mode
 * unreachable from a base colour.
 *
 * `.dark` follows `:root` for the same reason `styles.css` orders them that
 * way: the two selectors carry equal specificity, so the later block is what
 * wins wherever the class is active.
 *
 * A preset's `themeMapping` and `baseRules` are not re-emitted — `styles.css`
 * already compiles that mapping and reset once, and every preset in this
 * project uses the same one (D27). `radius` is a preset's to set; the
 * base-colour path leaves the project default alone.
 */
function tokenSetCss(
  light: TokenBlock,
  dark: TokenBlock,
  radius: string | undefined,
  typeset: Typeset,
  menuColour: MenuColour,
  menuAccent: MenuAccent,
): string {
  return `:root {
${radius === undefined ? "" : `  --radius: ${radius};\n`}${tokenBlockDeclarations(light)}
}

.dark {
${tokenBlockDeclarations(dark)}
}

${typesetCss(typeset)}
${menuTokensCss(menuColour, menuAccent)}`;
}

/**
 * The viewing user's effective stylesheet from their base colour (D26, #95),
 * generated from the Tailwind scale that base colour names. Computed fresh
 * from the stored appearance every time, never cached, so no stale value can
 * survive a change.
 */
function baseColourCss(
  baseColour: BaseColour,
  typeset: Typeset,
  menuColour: MenuColour,
  menuAccent: MenuAccent,
): string {
  const scale = basePalette[baseColour];
  return tokenSetCss(
    lightTokens(scale),
    darkTokens(scale),
    undefined,
    typeset,
    menuColour,
    menuAccent,
  );
}

/**
 * Resolves a user's `selectedPreset` against the shared server-listed
 * presets or their own personal list (#96) — a selection naming a preset
 * that no longer exists (removed server preset, deleted personal preset)
 * resolves to nothing rather than failing, so the base-colour path takes
 * over silently instead of the dashboard breaking.
 */
function resolveSelectedPreset(
  appearance: UserAppearance,
  serverPresets: readonly NamedPreset[],
): Preset | undefined {
  const { selectedPreset } = appearance;
  if (!selectedPreset) return undefined;
  const list =
    selectedPreset.source === "server"
      ? serverPresets
      : appearance.personalPresets;
  return list.find(({ id }) => id === selectedPreset.id)?.preset;
}

/**
 * The viewing user's complete effective stylesheet (D26, D27, #94-#96): a
 * selected preset overrides the base-colour path entirely when it still
 * resolves, otherwise the base-colour lookup governs — either way, the
 * user's own typeset always applies on top.
 */
export function appearanceCss(
  appearance: UserAppearance,
  serverPresets: readonly NamedPreset[] = [],
): string {
  const preset = resolveSelectedPreset(appearance, serverPresets);
  return preset
    ? tokenSetCss(
        preset.light,
        preset.dark,
        preset.radius,
        appearance.typeset,
        appearance.menuColour,
        appearance.menuAccent,
      )
    : baseColourCss(
        appearance.baseColour,
        appearance.typeset,
        appearance.menuColour,
        appearance.menuAccent,
      );
}

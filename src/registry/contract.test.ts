import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

// This suite drives `tsc --noEmit` over small, self-contained fixture tiles to prove
// the registry contract: a tile's props are derived from its JSON Schema via
// `JsonSchemaToType`, so a schema/component mismatch is a type error.
//
// Fixtures live under the repo tree (not the OS temp dir) so TypeScript's module
// resolution walks up to the repo's node_modules and finds `react/jsx-runtime` types.
// The fixture root is excluded from the real project's tsconfig `include`, so it never
// leaks into `npm run typecheck`, and every fixture dir is removed after its test.

const repoRoot = path.resolve(__dirname, "../..");
const schemaModule = path.join(repoRoot, "src/registry/schema.ts");
const tscBin = path.join(repoRoot, "node_modules/typescript/bin/tsc");
const fixturesRoot = path.join(repoRoot, ".contract-fixtures-tmp");

mkdirSync(fixturesRoot, { recursive: true });

const fixtureDirs: string[] = [];

afterEach(() => {
  while (fixtureDirs.length > 0) {
    const dir = fixtureDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

afterAll(() => {
  rmSync(fixturesRoot, { recursive: true, force: true });
});

const writeFixture = (name: string, files: Record<string, string>): string => {
  const dir = mkdtempSync(path.join(fixturesRoot, `${name}-`));
  fixtureDirs.push(dir);

  const schemaImportPath = path
    .relative(dir, schemaModule)
    .replace(/\\/g, "/")
    .replace(/\.ts$/, "");

  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(dir, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      contents.replace("__SCHEMA_MODULE__", schemaImportPath),
      "utf8",
    );
  }

  writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "react-jsx",
          lib: ["ES2022", "DOM"],
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["**/*.ts", "**/*.tsx"],
      },
      null,
      2,
    ),
    "utf8",
  );

  return dir;
};

const runTsc = (dir: string): { code: number; output: string } => {
  const result = spawnSync(
    process.execPath,
    [tscBin, "--noEmit", "-p", path.join(dir, "tsconfig.json")],
    {
      encoding: "utf8",
      cwd: dir,
    },
  );
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
};

describe("registry contract: schema-derived props (B2 authoring)", () => {
  it("typechecks clean when a tile's schema and props agree, with realistic values", () => {
    const dir = writeFixture("agreement", {
      "schemas.local.ts": `
export const schemas = {
  "fixture-tile": {
    type: "object",
    properties: {
      LABEL: { type: "string", default: "" },
      VALUE: { type: "number", default: 0 },
      LIST_ITEMS: { type: "array", items: { type: "string" } },
    },
    required: ["LABEL", "VALUE", "LIST_ITEMS"],
  },
} as const
`,
      "fixture-tile.tsx": `
import type { JsonSchemaToType } from "__SCHEMA_MODULE__"
import { schemas } from "./schemas.local"

export type FixtureTileProps = JsonSchemaToType<(typeof schemas)["fixture-tile"]>

export default function FixtureTile({ LABEL, VALUE, LIST_ITEMS }: FixtureTileProps) {
  return (
    <div>
      {LABEL}
      {VALUE}
      {LIST_ITEMS.length}
    </div>
  )
}
`,
      "usage.tsx": `
import FixtureTile from "./fixture-tile"

const usage = <FixtureTile LABEL="Revenue" VALUE={42} LIST_ITEMS={["a", "b"]} />
`,
    });

    const { code, output } = runTsc(dir);

    expect(code, output).toBe(0);
  }, 30_000);

  it("fails, naming the prop, when the component destructures a key the schema does not declare", () => {
    const dir = writeFixture("extra-prop", {
      "schemas.local.ts": `
export const schemas = {
  "fixture-tile": {
    type: "object",
    properties: {
      LABEL: { type: "string", default: "" },
      VALUE: { type: "number", default: 0 },
    },
    required: ["LABEL", "VALUE"],
  },
} as const
`,
      "fixture-tile.tsx": `
import type { JsonSchemaToType } from "__SCHEMA_MODULE__"
import { schemas } from "./schemas.local"

export type FixtureTileProps = JsonSchemaToType<(typeof schemas)["fixture-tile"]>

export default function FixtureTile({ LABEL, VALUE, SUBTITLE }: FixtureTileProps) {
  return (
    <div>
      {LABEL}
      {VALUE}
      {SUBTITLE}
    </div>
  )
}
`,
    });

    const { code, output } = runTsc(dir);

    expect(code).not.toBe(0);
    expect(output).toContain("SUBTITLE");
  }, 30_000);

  it("fails, naming the prop, when the schema requires a key the component's declared props do not accept", () => {
    const dir = writeFixture("missing-required-in-component", {
      "schemas.local.ts": `
export const schemas = {
  "fixture-tile": {
    type: "object",
    properties: {
      LABEL: { type: "string", default: "" },
      VALUE: { type: "number", default: 0 },
      LIST_ITEMS: { type: "array", items: { type: "string" } },
    },
    required: ["LABEL", "VALUE", "LIST_ITEMS"],
  },
} as const
`,
      // The component's declared props are hand-typed instead of derived from the
      // schema, and drop LIST_ITEMS. This is the drift the contract must catch: an
      // agent updated the schema but not the component (or vice versa).
      "fixture-tile.tsx": `
type ComponentProps = { LABEL: string; VALUE: number }

export default function FixtureTile({ LABEL, VALUE }: ComponentProps) {
  return (
    <div>
      {LABEL}
      {VALUE}
    </div>
  )
}
`,
      "usage.tsx": `
import FixtureTile from "./fixture-tile"

const usage = <FixtureTile LABEL="Revenue" VALUE={42} LIST_ITEMS={["a", "b"]} />
`,
    });

    const { code, output } = runTsc(dir);

    expect(code).not.toBe(0);
    expect(output).toContain("LIST_ITEMS");
  }, 30_000);

  it('does not let a schema `default` narrow the prop type: a string default of "" still accepts "Revenue"', () => {
    const dir = writeFixture("default-does-not-narrow", {
      "schemas.local.ts": `
export const schemas = {
  "fixture-tile": {
    type: "object",
    properties: {
      LABEL: { type: "string", default: "" },
      VALUE: { type: "number", default: 0 },
    },
    required: ["LABEL", "VALUE"],
  },
} as const
`,
      "fixture-tile.tsx": `
import type { JsonSchemaToType } from "__SCHEMA_MODULE__"
import { schemas } from "./schemas.local"

export type FixtureTileProps = JsonSchemaToType<(typeof schemas)["fixture-tile"]>

const realisticValue: FixtureTileProps = { LABEL: "Revenue", VALUE: 42 }
`,
    });

    const { code, output } = runTsc(dir);

    expect(code, output).toBe(0);
  }, 30_000);

  it("resolves a defaultless property to its declared type, not `unknown`: a wrong-typed value fails", () => {
    const dir = writeFixture("defaultless-is-not-unknown", {
      "schemas.local.ts": `
export const schemas = {
  "fixture-tile": {
    type: "object",
    properties: {
      LABEL: { type: "string", default: "" },
      NOTE: { type: "string" },
    },
    required: ["LABEL", "NOTE"],
  },
} as const
`,
      "fixture-tile.tsx": `
import type { JsonSchemaToType } from "__SCHEMA_MODULE__"
import { schemas } from "./schemas.local"

export type FixtureTileProps = JsonSchemaToType<(typeof schemas)["fixture-tile"]>

function accepts(props: FixtureTileProps) {
  return props
}

// NOTE has no default. If it resolved to \`unknown\` instead of \`string\`, this
// wrong-typed value would be accepted.
const wrongType = { LABEL: "Revenue", NOTE: 123 }
accepts(wrongType)
`,
    });

    const { code, output } = runTsc(dir);

    expect(code).not.toBe(0);
    expect(output).toContain("NOTE");
  }, 30_000);

  const optionalitySchema = `
export const schemas = {
  "fixture-tile": {
    type: "object",
    properties: {
      LABEL: { type: "string", default: "" },
      NICKNAME: { type: "string" },
    },
    required: ["LABEL"],
  },
} as const
`;

  it("fails, naming the key, when a property listed in `required` is omitted", () => {
    const dir = writeFixture("required-key-omitted", {
      "schemas.local.ts": optionalitySchema,
      "fixture-tile.tsx": `
import type { JsonSchemaToType } from "__SCHEMA_MODULE__"
import { schemas } from "./schemas.local"

export type FixtureTileProps = JsonSchemaToType<(typeof schemas)["fixture-tile"]>

// LABEL is in \`required\`: omitting it must fail.
const missingRequired: FixtureTileProps = { NICKNAME: "x" }
`,
    });

    const { code, output } = runTsc(dir);

    expect(code).not.toBe(0);
    expect(output).toContain("LABEL");
  }, 30_000);

  it("passes when a property absent from `required` is omitted", () => {
    const dir = writeFixture("optional-key-omitted", {
      "schemas.local.ts": optionalitySchema,
      "fixture-tile.tsx": `
import type { JsonSchemaToType } from "__SCHEMA_MODULE__"
import { schemas } from "./schemas.local"

export type FixtureTileProps = JsonSchemaToType<(typeof schemas)["fixture-tile"]>

// NICKNAME is not in \`required\`: omitting it must pass.
const missingOptional: FixtureTileProps = { LABEL: "Revenue" }
`,
    });

    const { code, output } = runTsc(dir);

    expect(code, output).toBe(0);
  }, 30_000);
});

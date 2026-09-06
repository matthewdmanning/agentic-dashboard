import { describe, expect, it } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { CompositionNode } from "../contract";
import { generateComponentSource } from "./codegen";

describe("generateComponentSource", () => {
  it("renders a leaf node with no children", () => {
    const tree: CompositionNode = {
      component: "Badge",
      props: {},
      children: [],
    };
    expect(generateComponentSource(tree)).toMatchInlineSnapshot(`
      "import { Badge } from "@/components/ui/badge";

      export function GeneratedCardTemplate() {
        return (
          <Badge />
        );
      }
      "
    `);
  });

  it("renders nested children, grouping imports by their shadcn source file", () => {
    const tree: CompositionNode = {
      component: "Card",
      props: { size: "sm" },
      children: [
        {
          component: "CardHeader",
          props: {},
          children: [{ component: "CardTitle", props: {}, children: [] }],
        },
        {
          component: "CardContent",
          props: { "aria-live": "polite" },
          children: [{ component: "Badge", props: { variant: "secondary" }, children: [] }],
        },
      ],
    };
    const source = generateComponentSource(tree, "MyTemplate");
    expect(source).toContain('import { Badge } from "@/components/ui/badge";');
    expect(source).toContain(
      'import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";',
    );
    expect(source).toContain("export function MyTemplate()");
    expect(source).toContain('<Card size="sm">');
    expect(source).toContain('<CardContent aria-live="polite">');
    expect(source).toContain('<Badge variant="secondary" />');
    expect(source).toContain("<CardTitle />");
    expect(source).toContain("</CardHeader>");
    expect(source).toContain("</Card>");
  });

  it("is deterministic — same tree, same output", () => {
    const tree: CompositionNode = {
      component: "Button",
      props: { disabled: true },
      children: [],
    };
    expect(generateComponentSource(tree)).toBe(generateComponentSource(tree));
  });

  // Spawns a real `tsc` — around four seconds alone, and longer sharing a
  // machine with the assembly tests, which spawn their own. Well past vitest's
  // five-second default, so it names its own.
  it("produces source that type-checks against shadcn/ui's real component types", () => {
    const tree: CompositionNode = {
      component: "Card",
      props: {},
      children: [
        {
          component: "CardHeader",
          props: {},
          children: [{ component: "CardTitle", props: {}, children: [] }],
        },
        { component: "CardContent", props: {}, children: [] },
      ],
    };
    const source = generateComponentSource(tree);
    const file = join(process.cwd(), "src", "card-templates", "__smoke.tsx");
    writeFileSync(file, source);
    try {
      const tscBin = join(
        process.cwd(),
        "node_modules",
        "typescript",
        "bin",
        "tsc",
      );
      execFileSync(process.execPath, [tscBin, "--noEmit", "-p", "tsconfig.json"], {
        cwd: process.cwd(),
        stdio: "pipe",
        encoding: "utf8",
      });
    } catch (error) {
      const stdout = (error as { stdout?: string }).stdout ?? "";
      throw new Error(`tsc failed:\n${stdout}`);
    } finally {
      unlinkSync(file);
    }
  }, 60_000);

  it("fails a real component given a wrong prop type, not just an unknown one", () => {
    const tree: CompositionNode = {
      component: "Card",
      props: { size: "huge" },
      children: [],
    };
    const source = generateComponentSource(tree);
    const file = join(process.cwd(), "src", "card-templates", "__smoke-bad.tsx");
    writeFileSync(file, source);
    try {
      const tscBin = join(
        process.cwd(),
        "node_modules",
        "typescript",
        "bin",
        "tsc",
      );
      expect(() =>
        execFileSync(process.execPath, [tscBin, "--noEmit", "-p", "tsconfig.json"], {
          cwd: process.cwd(),
          stdio: "pipe",
          encoding: "utf8",
        }),
      ).toThrow();
    } finally {
      unlinkSync(file);
    }
  }, 60_000);
});

import { describe, expect, test, vi } from "vitest";
import type { CompositionNode } from "../contract";
import { generateComponentSource } from "./codegen";

// Separate file so the `node:fs/promises` mock doesn't shadow the real
// filesystem reads the rest of codegen.test.ts relies on.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: vi
      .fn()
      .mockRejectedValue(
        Object.assign(
          new Error(
            "ENOENT: no such file or directory, scandir 'src/components/ui'",
          ),
          { code: "ENOENT" },
        ),
      ),
  };
});

describe("generateComponentSource — missing components directory", () => {
  test("names the directory and the attempted operation instead of a bare ENOENT", async () => {
    const tree: CompositionNode = {
      component: "Badge",
      props: {},
      children: [],
    };
    await expect(generateComponentSource(tree)).rejects.toThrow(
      /Could not read component library directory ".*components[\\/]+ui".*resolve card-template imports/,
    );
  });
});

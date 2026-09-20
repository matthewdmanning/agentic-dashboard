import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateWorkspaceConfig } from "./workspace";

let workspace: string;

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const write = (name: string, content: unknown) =>
  writeFileSync(path.join(workspace, name), JSON.stringify(content), "utf8");

describe("validateWorkspaceConfig", () => {
  it("accepts a components.json and registry.json that stay inside the workspace", () => {
    workspace = mkdtempSync(path.join(tmpdir(), "workspace-test-"));
    write("components.json", {
      tailwind: { css: "styles.css" },
      aliases: { components: "@/components", ui: "@/components/ui" },
    });
    write("registry.json", {
      items: [
        { name: "stat-tile", files: [{ path: "registry/stat-tile.tsx" }] },
      ],
    });
    expect(() => validateWorkspaceConfig(workspace)).not.toThrow();
  });

  it("rejects a components.json alias that escapes the workspace", () => {
    workspace = mkdtempSync(path.join(tmpdir(), "workspace-test-"));
    write("components.json", {
      tailwind: { css: "styles.css" },
      aliases: { components: "@/../../outside" },
    });
    expect(() => validateWorkspaceConfig(workspace)).toThrow(
      /outside the workspace/,
    );
  });

  it("rejects a registry.json file target that escapes the workspace", () => {
    workspace = mkdtempSync(path.join(tmpdir(), "workspace-test-"));
    write("registry.json", {
      items: [{ name: "evil", files: [{ path: "../../outside.tsx" }] }],
    });
    expect(() => validateWorkspaceConfig(workspace)).toThrow(
      /outside the workspace/,
    );
  });
});

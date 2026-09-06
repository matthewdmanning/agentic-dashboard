import { describe, expect, test } from "vitest";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cardTemplateSourceFiles, includedCardTemplates } from "../client/cards";
import { createService, type DashboardPersistence } from "../service";
import { defaultDashboardConfiguration } from "../contract";
import { handleRegistryRequest } from "./registry";
import {
  useTestCardTemplates,
  withTestCard,
} from "../test-support/card-template";

describe("dashboard registry", () => {
  useTestCardTemplates();

  test("index lists every included card template, no file content", async () => {
    const response = await handleRegistryRequest(
      new Request("http://dashboard/r/registry.json"),
    );
    const body = await response.json();

    expect(body.$schema).toBe("https://ui.shadcn.com/schema/registry.json");
    expect(body.items.map((item: { name: string }) => item.name).sort()).toEqual(
      Object.keys(includedCardTemplates).sort(),
    );
    for (const item of body.items) {
      expect(item.files[0].content).toBeUndefined();
    }
  });

  test("item endpoint serves the template's real source file, with content", async () => {
    const response = await handleRegistryRequest(
      new Request("http://dashboard/r/message.json"),
    );
    const body = await response.json();

    expect(body.name).toBe("message");
    expect(body.type).toBe("registry:block");
    expect(body.files[0].path).toBe(
      `src/client/cards/${cardTemplateSourceFiles.message}`,
    );
    expect(body.files[0].content).toContain("CardView");
  });

  test("unknown item name 404s", async () => {
    const response = await handleRegistryRequest(
      new Request("http://dashboard/r/not-a-template.json"),
    );
    expect(response.status).toBe(404);
  });

  test("a template sharing a file with others still resolves its own item", async () => {
    const response = await handleRegistryRequest(
      new Request("http://dashboard/r/chart.json"),
    );
    const body = await response.json();

    expect(body.name).toBe("chart");
    expect(body.files[0].path).toBe(
      `src/client/cards/${cardTemplateSourceFiles.chart}`,
    );
  });
});

describe("a successful assemble makes the registry serve the promoted item", () => {
  function createMemoryPersistence(): DashboardPersistence {
    let configuration = structuredClone(defaultDashboardConfiguration);
    return {
      read: async () => structuredClone(configuration),
      write: async (next) => {
        configuration = structuredClone(next);
      },
    };
  }

  test("the registry index and item endpoint reflect the newly promoted template", async () => {
    const dir = await mkdtemp(join(tmpdir(), "registry-promotion-"));
    const cardTemplateManifestPath = join(dir, "manifest.json");
    await writeFile(cardTemplateManifestPath, "{}\n");
    const cardTemplateClientBuildPath = join(dir, "client-build.json");
    const templatePath = join(
      process.cwd(),
      "src",
      "client",
      "cards",
      "registry-test-assembled.tsx",
    );
    const service = createService({
      persistence: createMemoryPersistence(),
      cardTemplateManifestPath,
      cardTemplateClientBuildPath,
    });

    try {
      await service.apply([
        {
          type: "assemble-card-template",
          template: "registry-test-assembled",
          jsonSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          composition: { component: "Badge", props: {}, children: [] },
        },
      ]);

      const index = await handleRegistryRequest(
        new Request("http://dashboard/r/registry.json"),
        { manifestPath: cardTemplateManifestPath },
      );
      const indexBody = await index.json();
      expect(
        indexBody.items.map((item: { name: string }) => item.name),
      ).toContain("registry-test-assembled");

      const item = await handleRegistryRequest(
        new Request("http://dashboard/r/registry-test-assembled.json"),
        { manifestPath: cardTemplateManifestPath },
      );
      const itemBody = await item.json();
      expect(itemBody.name).toBe("registry-test-assembled");
      expect(itemBody.files[0].content).toContain(
        'import { Badge } from "@/components/ui/badge"',
      );
      expect(itemBody.registryDependencies).toEqual(["badge"]);
    } finally {
      await unlink(templatePath).catch(() => undefined);
    }
  });
});

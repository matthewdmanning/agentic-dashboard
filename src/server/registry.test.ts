import { describe, expect, test } from "vitest";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cardTemplateSourceFiles,
  includedCardTemplates,
} from "../client/cards";
import { createService, type DashboardPersistence } from "../service";
import { defaultDashboardConfiguration } from "../contract";
import { handleRegistryRequest } from "./registry";
import {
  useTestCardTemplates,
  withTestCard,
} from "../test-support/card-template";

function createMemoryPersistence(): DashboardPersistence {
  let configuration = structuredClone(defaultDashboardConfiguration);
  return {
    read: async () => structuredClone(configuration),
    write: async (next) => {
      configuration = structuredClone(next);
    },
  };
}

describe("dashboard registry", () => {
  useTestCardTemplates();

  // No `localUserToken` configured (D35): an unproven caller resolves to the
  // local user, matching a workspace that never provisioned one, so these
  // stay focused on registry shape rather than authorization.
  const service = createService({ persistence: createMemoryPersistence() });

  test("index lists every included card template, no file content", async () => {
    const response = await handleRegistryRequest(
      new Request("http://dashboard/r/registry.json"),
      { service },
    );
    const body = await response.json();

    expect(body.$schema).toBe("https://ui.shadcn.com/schema/registry.json");
    expect(
      body.items.map((item: { name: string }) => item.name).sort(),
    ).toEqual(Object.keys(includedCardTemplates).sort());
    for (const item of body.items) {
      expect(item.files[0].content).toBeUndefined();
    }
  });

  test("item endpoint serves the template's real source file, with content", async () => {
    const response = await handleRegistryRequest(
      new Request("http://dashboard/r/message.json"),
      { service },
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
      { service },
    );
    expect(response.status).toBe(404);
  });

  test("a template sharing a file with others still resolves its own item", async () => {
    const response = await handleRegistryRequest(
      new Request("http://dashboard/r/chart.json"),
      { service },
    );
    const body = await response.json();

    expect(body.name).toBe("chart");
    expect(body.files[0].path).toBe(
      `src/client/cards/${cardTemplateSourceFiles.chart}`,
    );
  });
});

describe("registry authorization", () => {
  useTestCardTemplates();

  // `localUserToken` configured (D35): an unproven caller resolves to
  // `unauthenticatedUser`, so these exercise the same denial a real
  // deployment gives an unauthenticated caller on `/r/*`.
  function createGatedService() {
    return createService({
      persistence: createMemoryPersistence(),
      localUserToken: "secret",
    });
  }

  // `handleRegistryRequest` lets `ServiceFailure` propagate (the route in
  // server/index.ts maps it to a status via `failureResponse`), so a denial
  // here is a rejection, not a 200 with an empty body — proof enough that no
  // file was ever read: the throw happens before `buildRegistryItem`.
  test("an unauthenticated item request is denied, no source read", async () => {
    await expect(
      handleRegistryRequest(new Request("http://dashboard/r/message.json"), {
        service: createGatedService(),
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  test("an unauthenticated index request is denied", async () => {
    await expect(
      handleRegistryRequest(new Request("http://dashboard/r/registry.json"), {
        service: createGatedService(),
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  test("a valid local-user credential still serves the index and item with content", async () => {
    const service = createGatedService();
    const headers = { authorization: "Bearer secret" };

    const index = await handleRegistryRequest(
      new Request("http://dashboard/r/registry.json", { headers }),
      { service },
    );
    expect(index.status).toBe(200);
    const indexBody = await index.json();
    expect(
      indexBody.items.map((item: { name: string }) => item.name).sort(),
    ).toEqual(Object.keys(includedCardTemplates).sort());

    const item = await handleRegistryRequest(
      new Request("http://dashboard/r/message.json", { headers }),
      { service },
    );
    expect(item.status).toBe(200);
    const itemBody = await item.json();
    expect(itemBody.name).toBe("message");
    expect(itemBody.files[0].content).toContain("CardView");
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
        { manifestPath: cardTemplateManifestPath, service },
      );
      const indexBody = await index.json();
      expect(
        indexBody.items.map((item: { name: string }) => item.name),
      ).toContain("registry-test-assembled");

      const item = await handleRegistryRequest(
        new Request("http://dashboard/r/registry-test-assembled.json"),
        { manifestPath: cardTemplateManifestPath, service },
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

import { afterAll, beforeAll } from "vitest";
import * as z from "zod/v4";

import { cardTemplateSchemas, type DashboardConfiguration } from "../contract";
import { activeCardTemplateManifest } from "../card-templates/manifest";
import { cardTemplateSourceFiles, includedCardTemplates } from "../client/cards";

/**
 * Card template schemas for tests only.
 *
 * The five that shipped were deleted in D32 — they rendered raw HTML with no
 * styling and were not a base to build shadcn templates on — so
 * Tests about the service, the contract, and the registry may register fixture
 * templates without changing the shipped manifest.
 */
export const testCardTemplateSchemas: Record<string, z.ZodType<unknown>> = {
  message: z.object({ message: z.string() }).strict(),
  table: z
    .object({
      columns: z.array(z.object({ key: z.string(), label: z.string() }).strict()),
      rows: z.array(
        z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
      ),
    })
    .strict(),
  list: z
    .object({
      items: z.array(
        z
          .object({
            id: z.string(),
            title: z.string(),
            body: z.string().optional(),
          })
          .strict(),
      ),
    })
    .strict(),
  calendar: z
    .object({
      events: z.array(
        z
          .object({
            id: z.string(),
            title: z.string(),
            start: z.string(),
            end: z.string().optional(),
          })
          .strict(),
      ),
    })
    .strict(),
  chart: z
    .object({
      title: z.string(),
      summary: z.string(),
      series: z.array(
        z.object({ label: z.string(), value: z.number() }).strict(),
      ),
    })
    .strict(),
};

/**
 * Registers the fixture templates for the duration of a test file, and removes
 * them afterwards so no test leaks a template into another's view of what this
 * dashboard has.
 *
 * `sourceFile` names a file that really exists under `src/client/cards`,
 * because the registry endpoint reads an item's content off disk.
 */
export function useTestCardTemplates(sourceFile = "CardView.tsx"): void {
  const originals = new Map(
    Object.keys(testCardTemplateSchemas).map((name) => [
      name,
      {
        schema: cardTemplateSchemas[name],
        sourceFile: cardTemplateSourceFiles[name],
        template: includedCardTemplates[name],
        manifest: activeCardTemplateManifest[name],
      },
    ]),
  );
  beforeAll(() => {
    for (const [name, schema] of Object.entries(testCardTemplateSchemas)) {
      cardTemplateSchemas[name] = schema;
      cardTemplateSourceFiles[name] = sourceFile;
      includedCardTemplates[name] = { schema, Component: () => null };
      activeCardTemplateManifest[name] = {
        name,
        type: "registry:block",
        title: name,
        sourceFile,
        schema,
        jsonSchema: { type: "object" },
      };
    }
  });

  afterAll(() => {
    for (const name of Object.keys(testCardTemplateSchemas)) {
      const original = originals.get(name);
      if (original?.schema) cardTemplateSchemas[name] = original.schema;
      else delete cardTemplateSchemas[name];
      if (original?.sourceFile) cardTemplateSourceFiles[name] = original.sourceFile;
      else delete cardTemplateSourceFiles[name];
      if (original?.template) includedCardTemplates[name] = original.template;
      else delete includedCardTemplates[name];
      if (original?.manifest) activeCardTemplateManifest[name] = original.manifest;
      else delete activeCardTemplateManifest[name];
    }
  });
}

/**
 * A configuration holding one card, standing in for the `welcome` card the
 * default configuration carried before D32 emptied it.
 */
export function withTestCard(
  configuration: DashboardConfiguration,
): DashboardConfiguration {
  return {
    ...configuration,
    dashboard: { ...configuration.dashboard, cards: ["welcome"] },
    cards: [
      {
        id: "welcome",
        title: "Dashboard",
        template: "message",
        state: { message: "Welcome to your dashboard." },
      },
    ],
  };
}

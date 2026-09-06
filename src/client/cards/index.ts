import type { ComponentType } from "react";
import type * as z from "zod/v4";
import {
  activeCardTemplateManifest,
  type CardTemplateManifestEntry,
} from "../../card-templates/manifest";
import type { CardTemplateName } from "../../contract";
import { MessageCard } from "./message";

export interface CardTemplate<T> {
  schema: z.ZodType<T>;
  Component: ComponentType<{ data: T }>;
}

const components: Record<string, ComponentType<{ data: unknown }>> = {
  message: MessageCard as ComponentType<{ data: unknown }>,
};

function toCardTemplate(
  entry: CardTemplateManifestEntry,
): CardTemplate<unknown> {
  const Component = components[entry.name];
  if (!Component) {
    throw new Error(`Missing card template component: ${entry.name}`);
  }
  return { schema: entry.schema, Component };
}

/** The active manifest is the source of truth for renderable templates. */
export const includedCardTemplates: Record<
  CardTemplateName | string,
  CardTemplate<unknown>
> = Object.fromEntries(
  Object.entries(activeCardTemplateManifest).map(([name, entry]) => [
    name,
    toCardTemplate(entry),
  ]),
);

/** Compatibility view used by registry tests and callers that need a path. */
export const cardTemplateSourceFiles: Record<string, string> =
  Object.fromEntries(
    Object.entries(activeCardTemplateManifest).map(([name, entry]) => [
      name,
      entry.sourceFile,
    ]),
  );

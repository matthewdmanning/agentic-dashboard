import {
  cardTemplateJsonSchemas,
  cardTemplateSchemas,
  type CardTemplateName,
} from "./schema";

export type JsonSchema = Record<string, unknown>;

export interface CardTemplateManifestEntry {
  name: CardTemplateName | string;
  type: "registry:block";
  title: string;
  sourceFile: string;
  schema: import("zod/v4").ZodType<unknown>;
  jsonSchema: JsonSchema;
}

/**
 * The active generation. Registry responses and the client card map both read
 * this manifest; a source-file scan or a second template-name list is not
 * authoritative.
 */
export const activeCardTemplateManifest: Record<
  string,
  CardTemplateManifestEntry
> = {
  message: {
    name: "message",
    type: "registry:block",
    title: "Message",
    sourceFile: "message.tsx",
    schema: cardTemplateSchemas.message,
    jsonSchema: cardTemplateJsonSchemas.message,
  },
};

export function serializableCardTemplateManifest() {
  return Object.fromEntries(
    Object.entries(activeCardTemplateManifest).map(([name, entry]) => [
      name,
      {
        name: entry.name,
        type: entry.type,
        title: entry.title,
        sourceFile: entry.sourceFile,
        jsonSchema: entry.jsonSchema,
      },
    ]),
  );
}

export { cardTemplateJsonSchemas, cardTemplateSchemas };

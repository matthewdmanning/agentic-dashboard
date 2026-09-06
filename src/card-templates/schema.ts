import * as z from "zod/v4";

/** State accepted by the default card template. */
const messageSchema = z
  .object({
    message: z.string(),
  })
  .strict();

export const cardTemplateSchemas: Record<string, z.ZodType<unknown>> = {
  message: messageSchema,
};

export type CardTemplateName = string;

/** JSON Schema is generated from the validator so the two cannot drift. */
export const cardTemplateJsonSchemas = {
  message: z.toJSONSchema(messageSchema),
};

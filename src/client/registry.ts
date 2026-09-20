import type { z } from "zod";

/** One entry of `GET /r/registry.json`. `meta.schema` is the JSON Schema the browser validates a tile's state against. */
export type RegistryItem = {
  readonly name: string;
  readonly type: string;
  readonly title: string;
  readonly description: string;
  readonly files: readonly { readonly path: string; readonly type: string }[];
  readonly meta: { readonly schema: z.core.JSONSchema.JSONSchema };
};

export type Registry = {
  readonly name: string;
  readonly homepage: string;
  readonly items: readonly RegistryItem[];
};

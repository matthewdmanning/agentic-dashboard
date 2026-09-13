type JsonSchema = {
  readonly type?: string;
  readonly default?: string | number | boolean | null;
  readonly items?: JsonSchema;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
};

type RequiredKeys<S extends JsonSchema> = S extends {
  readonly required: infer R extends readonly string[];
}
  ? R[number]
  : never;

type ObjectValue<S extends JsonSchema> = S extends {
  readonly properties: infer P extends Readonly<Record<string, JsonSchema>>;
}
  ? {
      [K in keyof P as K extends RequiredKeys<S>
        ? K
        : never]-?: JsonSchemaToType<P[K]>;
    } & {
      [K in keyof P as K extends RequiredKeys<S>
        ? never
        : K]?: JsonSchemaToType<P[K]>;
    }
  : Record<string, never>;

export type JsonSchemaToType<S extends JsonSchema> = S extends {
  readonly properties: Readonly<Record<string, JsonSchema>>;
}
  ? ObjectValue<S>
  : S extends { readonly type: "array" }
    ? S extends { readonly items: infer I extends JsonSchema }
      ? JsonSchemaToType<I>[]
      : unknown[]
    : S extends { readonly type: "boolean" }
      ? boolean
      : S extends { readonly type: "integer" | "number" }
        ? number
        : S extends { readonly type: "null" }
          ? null
          : S extends { readonly type: "string" }
            ? string
            : unknown;

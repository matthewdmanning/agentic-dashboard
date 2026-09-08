/** The built-in `"identity"` card mapper (CONTEXT.md): the result already fits the schema, so it passes through unchanged. Source-only — never reachable through the service. */
export function identityCardMapper<T>(source: T): T {
  return source;
}

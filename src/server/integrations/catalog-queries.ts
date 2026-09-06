import type { IntegrationCatalogEntry } from "./catalog";

/** Available catalog entries, retaining entries that have no connections. */
export function availableCatalogEntries(
  entries: readonly IntegrationCatalogEntry[],
): IntegrationCatalogEntry[] {
  return entries.filter(({ state }) => state === "available");
}

/** Settings choices are the distinct available service types in the catalog. */
export function connectableTypesFromCatalog(
  entries: readonly IntegrationCatalogEntry[],
): string[] {
  return [...new Set(availableCatalogEntries(entries).map(({ type }) => type))];
}

/** Pull dispatch starts from catalog types; unsupported adapters remain visible. */
export function catalogEntriesForAdapters<T>(
  entries: readonly IntegrationCatalogEntry[],
  adapters: Readonly<Record<string, T>>,
): IntegrationCatalogEntry[] {
  return availableCatalogEntries(entries).filter(
    ({ type }) => type in adapters,
  );
}

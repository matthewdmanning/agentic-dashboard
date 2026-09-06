import type { IntegrationCatalogEntry } from "../../contract";

/** Project-owned seed entries. They contain connection metadata only. */
export const defaultIntegrationCatalog: readonly IntegrationCatalogEntry[] = [
  {
    id: "google-calendar",
    type: "google-calendar",
    settings: {},
    origin: "default",
    state: "available",
  },
  {
    id: "recommended-google-calendar",
    type: "google-calendar",
    settings: {},
    origin: "recommended",
    state: "available",
  },
];

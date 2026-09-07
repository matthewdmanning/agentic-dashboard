import type { IntegrationCatalog, IntegrationCatalogEntry } from "./catalog";
import type { ConnectionStore } from "./connections";

const millisecondsPerDay = 24 * 60 * 60 * 1000;

/**
 * Reconciles the catalog's unused-tracking against live connections (D40,
 * #89): a dynamic entry with no remaining connections gets its unused clock
 * started, one that gained a connection back has that clock cleared, and one
 * whose clock has run past `retentionDays` is removed along with any stray
 * connection records for it. A default or recommended entry is never
 * touched — it has no expiry.
 *
 * ponytail: no scheduler. The caller is the trigger — once at server
 * startup, and once after every connection change (connect/disconnect) —
 * rather than a background timer polling on its own.
 */
export async function reconcileIntegrationRetention(
  dependencies: { catalog: IntegrationCatalog; connections: ConnectionStore },
  retentionDays: number,
  now: Date = new Date(),
): Promise<void> {
  const entries = await dependencies.catalog.read();
  const kept: IntegrationCatalogEntry[] = [];
  const expiredIds: string[] = [];
  let changed = false;

  for (const entry of entries) {
    if (entry.origin !== "dynamic") {
      kept.push(entry);
      continue;
    }

    const connectionCount = await dependencies.connections.countForEntry(
      entry.id,
    );
    if (connectionCount > 0) {
      if (entry.unusedSince !== undefined) changed = true;
      const { unusedSince: _unusedSince, ...connected } = entry;
      kept.push(connected);
      continue;
    }

    if (entry.unusedSince === undefined) {
      kept.push({ ...entry, unusedSince: now.toISOString() });
      changed = true;
      continue;
    }

    const ageMs = now.getTime() - new Date(entry.unusedSince).getTime();
    if (ageMs >= retentionDays * millisecondsPerDay) {
      expiredIds.push(entry.id);
      changed = true;
      continue;
    }

    kept.push(entry);
  }

  if (changed) await dependencies.catalog.write(kept);
  await Promise.all(
    expiredIds.map((id) => dependencies.connections.removeAllForEntry(id)),
  );
}

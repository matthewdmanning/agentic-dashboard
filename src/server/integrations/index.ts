import { compileCardMapper, type CardMapper, type Integration } from "../../contract";
import type { DashboardService } from "../../service";
import type { StoredQuery } from "../../service/queries";
import { identityCardMapper } from "../../client/card-mappers/identity";
import { pullGoogleCalendar, type FetchCalendar } from "./google-calendar";

/**
 * Resolves the authorization secret for one connection (an integration or a
 * backup target — D16), by the id that names it. The one seam every pull
 * goes through to reach a stored credential; no adapter reads a store of
 * its own.
 */
export type TokenProvider = (connectionId: string) => Promise<string>;

export interface PullContext {
  tokenProvider: TokenProvider;
  fetch?: FetchCalendar;
}

export type IntegrationPull = (
  integration: Integration,
  query: unknown,
  context: PullContext,
) => Promise<unknown>;

/**
 * Which services this build can pull from. The only place an integration type
 * is named — callers dispatch on what an integration says it is.
 */
export const integrationPulls: Record<string, IntegrationPull> = {
  "google-calendar": (integration, query, { tokenProvider, fetch }) =>
    pullGoogleCalendar({
      integrationId: integration.id,
      query,
      tokenProvider,
      fetch,
    }),
};

export interface QueryRefresh {
  cardId: string;
  status: "refreshed" | "unsupported" | "failed";
  message?: string;
}

/**
 * Resolves a query's `cardMapper` name to the function it names. `"identity"`
 * is the built-in, source-only mapper (CONTEXT.md) and never resolves
 * against the shared store; any other name resolves against `cardMappers`,
 * the store `service` reads for the caller (D38).
 */
function resolveCardMapper(
  cardMappers: readonly CardMapper[],
  name: string,
): ((input: unknown) => unknown) | undefined {
  if (name === "identity") return identityCardMapper;
  const mapper = cardMappers.find((candidate) => candidate.name === name);
  return mapper ? compileCardMapper(mapper.spec) : undefined;
}

/**
 * Runs a set of queries — the caller's own, resolved from their private store
 * (D32) — pulling each one's integration, shaping the result with the card
 * mapper it names, resolved against the shared store (D38), and applying it
 * as its card's new state through `service.apply`. Nothing else persists a
 * pull — a pulled result is transient (fetch, map, apply, discard); if a
 * mapper changes, re-pull. One query's failure does not stop the rest.
 *
 * Card state stays shared (D30): when two users' queries feed the same card,
 * whichever refresh's `patch-card-state` lands last is what everyone sees —
 * `service.apply`'s single serialized queue is what makes "last" well
 * defined (see the `ponytail:` note on `createService`'s `enqueue`).
 */
export async function refreshCardQueries(
  queries: readonly StoredQuery[],
  integrations: readonly Integration[],
  cardMappers: readonly CardMapper[],
  context: PullContext & { service: DashboardService; credential?: string },
): Promise<QueryRefresh[]> {
  const refreshes: QueryRefresh[] = [];

  for (const query of queries) {
    const integration = integrations.find(
      ({ id }) => id === query.integration,
    );
    if (!integration) {
      refreshes.push({
        cardId: query.cardId,
        status: "failed",
        message: `Unknown integration: ${query.integration}`,
      });
      continue;
    }

    const pull = integrationPulls[integration.type];
    if (!pull) {
      refreshes.push({ cardId: query.cardId, status: "unsupported" });
      continue;
    }

    const mapper = resolveCardMapper(cardMappers, query.cardMapper);
    if (!mapper) {
      refreshes.push({
        cardId: query.cardId,
        status: "failed",
        message: `Unknown card mapper: ${query.cardMapper}`,
      });
      continue;
    }

    try {
      const source = await pull(integration, query.query, context);
      const patch = mapper(source);
      await context.service.apply(
        [{ type: "patch-card-state", cardId: query.cardId, patch }],
        context.credential,
      );
      refreshes.push({ cardId: query.cardId, status: "refreshed" });
    } catch (error) {
      refreshes.push({
        cardId: query.cardId,
        status: "failed",
        message: error instanceof Error ? error.message : "Pull failed",
      });
    }
  }

  return refreshes;
}

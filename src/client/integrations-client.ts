import { authorized, failureFrom } from "./request";

export interface IntegrationRefresh {
  cardId: string;
  status: "refreshed" | "unsupported" | "failed";
  message?: string;
}

/** Runs every card's queries. The view names no service; the server dispatches. */
export async function refreshIntegrations(): Promise<IntegrationRefresh[]> {
  const response = await fetch("/api/integrations/refresh", authorized({ method: "POST" }));
  if (!response.ok) {
    throw await failureFrom(response, "Could not refresh integrations");
  }
  return (await response.json()) as IntegrationRefresh[];
}

/** The services this build can connect to. How Settings learns them, rather than naming one itself. */
export async function loadConnectableIntegrationTypes(): Promise<string[]> {
  const response = await fetch("/api/integrations/types", authorized());
  if (!response.ok) {
    throw await failureFrom(response, "Could not load connectable services");
  }
  return (await response.json()) as string[];
}

/**
 * The connect handoff for one connection: hands the service's secret to the
 * server, which stores it outside dashboard configuration, keyed by the
 * caller and this catalog entry (D40). Not a mutation — a credential never
 * reaches `contract` (it refuses a credential-shaped settings key), so this
 * has no `apply` payload of its own.
 */
export async function connectIntegration(
  integrationId: string,
  credential: string,
): Promise<void> {
  const response = await fetch(
    "/api/integrations/connect",
    authorized({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ integrationId, credential }),
    }),
  );
  if (!response.ok) {
    throw await failureFrom(response, "Could not connect integration");
  }
}

/**
 * The matching disconnect handoff: destroys the caller's own stored
 * credential for that catalog entry immediately (D40). Not wired into
 * Settings yet — its "Disconnect" button still removes the catalog entry
 * itself via a mutation. ponytail: wire this in when Settings gets a real
 * disconnect-without-removing control; not required by #88's acceptance.
 */
export async function disconnectIntegration(integrationId: string): Promise<void> {
  const response = await fetch(
    "/api/integrations/disconnect",
    authorized({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ integrationId }),
    }),
  );
  if (!response.ok) {
    throw await failureFrom(response, "Could not disconnect integration");
  }
}

import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer as createViteServer } from "vite";

import { createFileAuthStore } from "../auth";
import { provisionLocalUserToken } from "../auth/local-user";
import {
  parseDashboardConfiguration,
  type Mutation,
  type PartialUserAppearance,
} from "../contract";
import { createFileAppearanceStore } from "./appearance";
import { credentialFromRequest } from "./credential";
import {
  createFilePersistence,
  createService,
  ServiceFailure,
  type DashboardService,
  type ServiceFailureCode,
} from "../service";
import { createEncryptedQueryStore } from "../service/queries";
import {
  createEncryptedConnectionStore,
  type ConnectionStore,
} from "./integrations/connections";
import { createFileIntegrationCatalog } from "./integrations/catalog";
import { reconcileIntegrationRetention } from "./integrations/retention";
import { rotateSecretKeyIfDue } from "./key-rotation";
import {
  createSecretBox,
  defaultRotationIntervalDays,
  defaultSecretKeyRingPath,
  managedSecretsTokenEnvVar,
  managedSecretsUrlEnvVar,
  resolveManagedSecretKeyRing,
  rotationIntervalDaysEnvVar,
} from "./secret-box";
import { handleRegistryRequest } from "./registry";
import {
  defaultCardTemplateClientBuildPath,
  defaultCardTemplateManifestPath,
} from "../card-templates/active-manifest";
import type { FetchCalendar } from "./integrations/google-calendar";
import { refreshCardQueries, type TokenProvider } from "./integrations";

const readScopes = [
  "all",
  "role",
  "data",
  "cards",
  "presentation",
  "integrations",
  "roles",
  "queries",
  "cardMappers",
] as const;

export async function handleDashboardConfigurationRequest(
  request: Request,
  service: DashboardService,
): Promise<Response> {
  try {
    if (request.method === "GET") {
      const scope = new URL(request.url).searchParams.get("scope") ?? "all";
      if (!(readScopes as readonly string[]).includes(scope)) {
        return Response.json(
          { code: "invalid-request", message: "Unknown dashboard scope" },
          { status: 400 },
        );
      }
      return Response.json(
        await readDashboardScope(
          service,
          scope as (typeof readScopes)[number],
          request,
        ),
      );
    }

    if (request.method === "POST") {
      return Response.json(
        await service.apply(
          (await request.json()) as readonly Mutation[],
          credentialFromRequest(request),
        ),
      );
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (error) {
    return failureResponse(error);
  }
}

/** The service names why a call failed; HTTP is one vocabulary for that. */
const failureStatus: Record<ServiceFailureCode, number> = {
  "unknown-credential": 401,
  "authentication-unavailable": 500,
  "permission-denied": 403,
  "unknown-role": 500,
  "unknown-id": 404,
  "duplicate-id": 409,
  "in-use": 409,
  "connections-unavailable": 500,
  "queries-unavailable": 500,
  "invalid-card-template": 422,
  "integration-blocked": 409,
  "appearance-unavailable": 500,
};

function failureResponse(error: unknown): Response {
  if (error instanceof ServiceFailure) {
    return Response.json(
      { code: error.code, message: error.message },
      { status: failureStatus[error.code] },
    );
  }
  // A malformed request never reached the service.
  return Response.json(
    {
      code: "invalid-request",
      message: error instanceof Error ? error.message : "Invalid request",
    },
    { status: 400 },
  );
}

async function readDashboardScope(
  service: DashboardService,
  scope: (typeof readScopes)[number],
  request: Request,
) {
  const credential = credentialFromRequest(request);
  switch (scope) {
    case "all":
      return service.read("all", credential);
    case "role":
      return service.read("role", credential);
    case "data":
      return service.read("data", credential);
    case "cards":
      return service.read("cards", credential);
    case "presentation":
      return service.read("presentation", credential);
    case "integrations":
      return service.read("integrations", credential);
    case "roles":
      return service.read("roles", credential);
    case "queries":
      return service.read("queries", credential);
    case "cardMappers":
      return service.read("cardMappers", credential);
  }
}

/**
 * Scopes every pull in this refresh to one owner (#90): the caller who
 * requested it, resolved once via `service.owner` and closed over here —
 * never a payload field, and never substituted with another user's
 * connection when theirs is missing or was disconnected.
 */
export async function handleIntegrationRefreshRequest(
  request: Request,
  dependencies: {
    service: DashboardService;
    connections: ConnectionStore;
    fetch?: FetchCalendar;
  },
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const credential = credentialFromRequest(request);
  const [owner, queries, integrations, cardMappers, cards] = await Promise.all([
    dependencies.service.owner(credential),
    dependencies.service.read("queries", credential),
    dependencies.service.read("integrations", credential),
    dependencies.service.read("cardMappers", credential),
    dependencies.service.read("cards", credential),
  ]);
  const tokenProvider: TokenProvider = async (catalogEntryId) => {
    const connectionCredential = owner
      ? await dependencies.connections.get(owner, catalogEntryId)
      : undefined;
    if (!connectionCredential) {
      throw new Error(
        `Integration '${catalogEntryId}' is not connected. Connect it in Settings.`,
      );
    }
    return connectionCredential;
  };
  return Response.json(
    await refreshCardQueries(queries, integrations, cardMappers, cards, {
      tokenProvider,
      fetch: dependencies.fetch,
      service: dependencies.service,
      credential,
    }),
  );
}

/**
 * How Settings learns which services can be connected, without naming one
 * itself. Resolves a role like every other request (D4) — gated at
 * `integrations: read` inside `service.connectableTypes`, the one
 * enforcement point, rather than a second check here.
 */
export async function handleIntegrationTypesRequest(
  request: Request,
  service: DashboardService,
): Promise<Response> {
  try {
    return Response.json(
      await service.connectableTypes(credentialFromRequest(request)),
    );
  } catch (error) {
    return failureResponse(error);
  }
}

/**
 * How Settings learns which of the caller's own connections stopped working
 * (D40, #92) — ungated inside `service.blockedIntegrationNotices`, since a
 * user's own connection is theirs to know about by structure, not by
 * permission.
 */
export async function handleBlockedIntegrationNoticesRequest(
  request: Request,
  service: DashboardService,
): Promise<Response> {
  try {
    return Response.json(
      await service.blockedIntegrationNotices(credentialFromRequest(request)),
    );
  } catch (error) {
    return failureResponse(error);
  }
}

/**
 * How Settings learns which of the caller's own queries went unavailable
 * (D40, #93) — force-removing a dependent integration never cascade-deletes
 * a query, so this is how an owner learns theirs stopped working. Ungated
 * inside `service.unavailableQueryIntegrations`, the same reasoning as
 * `blockedIntegrationNotices`.
 */
export async function handleUnavailableQueryNoticesRequest(
  request: Request,
  service: DashboardService,
): Promise<Response> {
  try {
    return Response.json(
      await service.unavailableQueryIntegrations(
        credentialFromRequest(request),
      ),
    );
  } catch (error) {
    return failureResponse(error);
  }
}

/**
 * The connect handoff: hands a connection's secret to `service.connect`,
 * which is the enforcement point (D1, D4) -- the same one MCP's
 * `connect-integration` tool calls, so a role check here would be a second
 * door. Ungated (D35): the caller resolved inside `service.connect` is
 * always who the connection belongs to.
 */
export async function handleIntegrationConnectRequest(
  request: Request,
  service: DashboardService,
): Promise<Response> {
  try {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const body = (await request.json()) as {
      integrationId?: string;
      credential?: string;
    };
    if (!body.integrationId || !body.credential) {
      return Response.json(
        {
          code: "invalid-request",
          message: "integrationId and credential are required",
        },
        { status: 400 },
      );
    }

    await service.connect(
      body.integrationId,
      body.credential,
      credentialFromRequest(request),
    );
    return Response.json({ ok: true });
  } catch (error) {
    return failureResponse(error);
  }
}

/**
 * The matching disconnect handoff: destroys the caller's own stored
 * credential for that catalog entry immediately, the entry itself untouched
 * (D40). Same enforcement point and same ungated structure as `connect`.
 */
export async function handleIntegrationDisconnectRequest(
  request: Request,
  service: DashboardService,
): Promise<Response> {
  try {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const body = (await request.json()) as { integrationId?: string };
    if (!body.integrationId) {
      return Response.json(
        { code: "invalid-request", message: "integrationId is required" },
        { status: 400 },
      );
    }

    await service.disconnect(
      body.integrationId,
      credentialFromRequest(request),
    );
    return Response.json({ ok: true });
  } catch (error) {
    return failureResponse(error);
  }
}

/**
 * The caller's own appearance preference and its derived stylesheet (D26,
 * D33-D35, #94). Ungated inside `service.readAppearance`/`setAppearance`,
 * the same reasoning as `blockedIntegrationNotices` — a user's own
 * appearance is theirs to read and change by structure, not by permission.
 */
export async function handleAppearanceRequest(
  request: Request,
  service: DashboardService,
): Promise<Response> {
  try {
    if (request.method === "GET") {
      return Response.json(
        await service.readAppearance(credentialFromRequest(request)),
      );
    }

    if (request.method === "POST") {
      const body = (await request.json()) as PartialUserAppearance;
      return Response.json(
        await service.setAppearance(body, credentialFromRequest(request)),
      );
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (error) {
    return failureResponse(error);
  }
}

async function startServer() {
  const workspace = resolve(process.env.DASHBOARD_WORKSPACE ?? ".");
  const dashboardPath =
    process.env.DASHBOARD_DATA_PATH ??
    join(workspace, ".dashboard", "dashboard.json");
  const authStorePath =
    process.env.DASHBOARD_AUTH_STORE_PATH ??
    join(workspace, ".dashboard", "accounts.json");
  const connectionsPath =
    process.env.DASHBOARD_CONNECTIONS_PATH ??
    join(workspace, ".dashboard", "connections.json");
  const catalogPath =
    process.env.DASHBOARD_INTEGRATION_CATALOG_PATH ??
    join(workspace, ".dashboard", "integrations.json");
  // One encrypted store for every user's queries (D41) — no per-user directory.
  const queriesPath =
    process.env.DASHBOARD_QUERIES_PATH ??
    join(workspace, ".dashboard", "queries.json");
  // Outside the data directory by construction (D41): the OS home directory,
  // not the workspace `dashboardPath` et al. sit under.
  const secretKeyRingPath =
    process.env.DASHBOARD_SECRET_KEY_PATH ?? defaultSecretKeyRingPath();
  const rotationIntervalDays = Number(
    process.env[rotationIntervalDaysEnvVar] ?? defaultRotationIntervalDays,
  );
  const localUserTokenPath =
    process.env.DASHBOARD_LOCAL_USER_TOKEN_PATH ??
    join(workspace, ".dashboard", "local-user-token");
  const cardTemplateManifestPath =
    process.env.DASHBOARD_TEMPLATE_MANIFEST_PATH ??
    defaultCardTemplateManifestPath(workspace);
  const cardTemplateClientBuildPath =
    process.env.DASHBOARD_CLIENT_BUILD_PATH ??
    defaultCardTemplateClientBuildPath(workspace);
  const appearancePath =
    process.env.DASHBOARD_APPEARANCE_PATH ??
    join(workspace, ".dashboard", "appearance.json");
  // The project-owned template every user's effective `components.json` is
  // generated from (D33, D34, #94) — the workspace copy `init-dashboard`
  // seeds from the repo's own `components.json`.
  const componentsTemplatePath =
    process.env.DASHBOARD_COMPONENTS_PATH ?? join(workspace, "components.json");
  const userComponentsDir =
    process.env.DASHBOARD_USER_COMPONENTS_PATH ??
    join(workspace, ".dashboard", "components");
  // Loopback proves same machine, not same user (D35). The token file does —
  // only the OS account running this process can read it.
  const localUserToken = await provisionLocalUserToken(localUserTokenPath);
  // One host-held key ring seals both stores (D28, D41, #91) — queries and
  // connections are the two callers D41 names for this seam, and the two
  // stores #91's rotation re-encrypts together.
  //
  // A managed secrets URL (#98, D42) switches custody of that ring to a
  // deployer-configured service instead of this host's own file — nothing
  // downstream changes. Local key rotation is a local-file concern (it
  // writes the ring back to disk and re-encrypts local stores under a
  // locally-generated key), so it doesn't run in managed mode; the managed
  // service owns its own rotation cadence.
  const managedSecretsUrl = process.env[managedSecretsUrlEnvVar];
  // ponytail: fetched once at startup, not re-polled. If the managed service
  // rotates its key and later prunes the old version before this process
  // next restarts, anything sealed under that pruned key becomes unopenable.
  // Add periodic re-fetch (or a refresh signal) if a deployment needs to
  // survive a managed-side rotation without a restart.
  const ring = managedSecretsUrl
    ? await resolveManagedSecretKeyRing(
        managedSecretsUrl,
        process.env[managedSecretsTokenEnvVar],
      )
    : (
        await rotateSecretKeyIfDue(
          {
            keyRingPath: secretKeyRingPath,
            connectionsPath,
            queriesPath,
          },
          rotationIntervalDays,
        )
      ).ring;
  const secretBox = createSecretBox(ring);
  const connections = createEncryptedConnectionStore(
    connectionsPath,
    secretBox,
  );
  const catalog = createFileIntegrationCatalog(catalogPath);
  const queries = createEncryptedQueryStore(queriesPath, secretBox);
  const persistence = createFilePersistence(dashboardPath);
  const appearance = createFileAppearanceStore(appearancePath);
  const service = createService({
    persistence,
    authStore: createFileAuthStore(authStorePath),
    connections,
    catalog,
    queries,
    localUserToken,
    cardTemplateManifestPath,
    cardTemplateClientBuildPath,
    appearance,
    appearanceComponents: {
      dir: userComponentsDir,
      templatePath: componentsTemplatePath,
    },
  });
  // Cleanup runs at startup and after every connection change (#89) — no
  // scheduler. This is the startup half; `service` covers the other trigger.
  {
    const { integrationRetentionDays } = parseDashboardConfiguration(
      await persistence.read(),
    );
    await reconcileIntegrationRetention(
      { catalog, connections },
      integrationRetentionDays,
    );
  }
  const vite = await createViteServer({ server: { middlewareMode: true } });
  const server = createServer(async (request, response) => {
    if (request.url?.startsWith("/api/dashboard-configuration")) {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const result = await handleDashboardConfigurationRequest(
          new Request(`http://dashboard${request.url}`, {
            method: request.method,
            headers: authorizationHeaders(request),
            body: chunks.length
              ? Buffer.concat(chunks).toString("utf8")
              : undefined,
          }),
          service,
        );
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch (error) {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end(
          error instanceof Error ? error.message : "Invalid request",
        );
      }
      return;
    }

    if (request.url === "/api/integrations/types") {
      try {
        const result = await handleIntegrationTypesRequest(
          new Request(`http://dashboard${request.url}`, {
            method: request.method,
            headers: authorizationHeaders(request),
          }),
          service,
        );
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch (error) {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end(
          error instanceof Error ? error.message : "Invalid request",
        );
      }
      return;
    }

    if (request.url === "/api/integrations/blocked-notices") {
      try {
        const result = await handleBlockedIntegrationNoticesRequest(
          new Request(`http://dashboard${request.url}`, {
            method: request.method,
            headers: authorizationHeaders(request),
          }),
          service,
        );
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch (error) {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end(
          error instanceof Error ? error.message : "Invalid request",
        );
      }
      return;
    }

    if (request.url === "/api/integrations/unavailable-query-notices") {
      try {
        const result = await handleUnavailableQueryNoticesRequest(
          new Request(`http://dashboard${request.url}`, {
            method: request.method,
            headers: authorizationHeaders(request),
          }),
          service,
        );
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch (error) {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end(
          error instanceof Error ? error.message : "Invalid request",
        );
      }
      return;
    }

    if (request.url === "/api/appearance") {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const result = await handleAppearanceRequest(
          new Request(`http://dashboard${request.url}`, {
            method: request.method,
            headers: authorizationHeaders(request),
            body: chunks.length
              ? Buffer.concat(chunks).toString("utf8")
              : undefined,
          }),
          service,
        );
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch (error) {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end(
          error instanceof Error ? error.message : "Invalid request",
        );
      }
      return;
    }

    if (request.url === "/api/integrations/connect") {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const result = await handleIntegrationConnectRequest(
          new Request(`http://dashboard${request.url}`, {
            method: request.method,
            headers: authorizationHeaders(request),
            body: chunks.length
              ? Buffer.concat(chunks).toString("utf8")
              : undefined,
          }),
          service,
        );
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch (error) {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end(error instanceof Error ? error.message : "Connect failed");
      }
      return;
    }

    if (request.url === "/api/integrations/disconnect") {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const result = await handleIntegrationDisconnectRequest(
          new Request(`http://dashboard${request.url}`, {
            method: request.method,
            headers: authorizationHeaders(request),
            body: chunks.length
              ? Buffer.concat(chunks).toString("utf8")
              : undefined,
          }),
          service,
        );
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch (error) {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end(
          error instanceof Error ? error.message : "Disconnect failed",
        );
      }
      return;
    }

    if (request.url === "/api/integrations/refresh") {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const result = await handleIntegrationRefreshRequest(
          new Request(`http://dashboard${request.url}`, {
            method: request.method,
            headers: authorizationHeaders(request),
            body: chunks.length
              ? Buffer.concat(chunks).toString("utf8")
              : undefined,
          }),
          { connections, service },
        );
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch (error) {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end(error instanceof Error ? error.message : "Refresh failed");
      }
      return;
    }

    if (request.url?.startsWith("/r/")) {
      try {
        const result = await handleRegistryRequest(
          new Request(`http://dashboard${request.url}`, {
            headers: authorizationHeaders(request),
          }),
          { manifestPath: cardTemplateManifestPath, service },
        );
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch (error) {
        // Same door as every other route (D4): gated inside
        // `handleRegistryRequest` via `service.read("cards", ...)`, so a
        // denial surfaces here as a thrown ServiceFailure, not a status code.
        const result = failureResponse(error);
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      }
      return;
    }

    vite.middlewares(request, response, () => undefined);
  });

  const port = Number(process.env.PORT ?? 5173);
  server.listen(port, "127.0.0.1");
  // Printed, not served: whoever can read this process's stdout is the OS user
  // running it. Another account on the same host can reach the port but never
  // sees this line, and the page it would load carries no token.
  process.stdout.write(
    `Dashboard: http://127.0.0.1:${port}/?token=${localUserToken}
`,
  );
}

function authorizationHeaders(request: import("node:http").IncomingMessage) {
  const authorization = request.headers.authorization;
  return typeof authorization !== "string" ? undefined : { authorization };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void startServer();
}

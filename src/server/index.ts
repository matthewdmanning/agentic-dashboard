import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer as createViteServer } from "vite";

import { createFileAuthStore } from "../auth";
import { provisionLocalUserToken } from "../auth/local-user";
import type { Mutation } from "../contract";
import {
  createFilePersistence,
  createService,
  ServiceFailure,
  type DashboardService,
  type ServiceFailureCode,
} from "../service";
import { createFileCredentialStore } from "./integrations/credentials";
import { createFileIntegrationCatalog } from "./integrations/catalog";
import { handleRegistryRequest } from "./registry";
import {
  defaultCardTemplateClientBuildPath,
  defaultCardTemplateManifestPath,
} from "../card-templates/active-manifest";
import type { FetchCalendar } from "./integrations/google-calendar";
import {
  refreshCardQueries,
  type TokenProvider,
} from "./integrations";

const readScopes = [
  "all",
  "role",
  "data",
  "cards",
  "presentation",
  "integrations",
  "roles",
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
        await readDashboardScope(service, scope as (typeof readScopes)[number], request),
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
  "credentials-unavailable": 500,
  "invalid-card-template": 422,
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
  }
}

function credentialFromRequest(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (authorization === null) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) {
    throw new ServiceFailure(
      "unknown-credential",
      "Invalid authorization header",
    );
  }
  return match[1];
}

export async function handleIntegrationRefreshRequest(
  request: Request,
  dependencies: {
    service: DashboardService;
    tokenProvider: TokenProvider;
    fetch?: FetchCalendar;
  },
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const credential = credentialFromRequest(request);
  const [cards, integrations] = await Promise.all([
    dependencies.service.read("cards", credential),
    dependencies.service.read("integrations", credential),
  ]);
  return Response.json(
    await refreshCardQueries(cards, integrations, { ...dependencies, credential }),
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
 * The authorization handoff: hands a connection's secret to
 * `service.authorize`, which is the enforcement point (D1, D4) -- the same
 * one MCP's `authorize-integration` tool calls, so a role check here would
 * be a second door.
 */
export async function handleIntegrationAuthorizeRequest(
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

    await service.authorize(
      body.integrationId,
      body.credential,
      credentialFromRequest(request),
    );
    return Response.json({ ok: true });
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
  const credentialsPath =
    process.env.DASHBOARD_INTEGRATION_CREDENTIALS_PATH ??
    join(workspace, ".dashboard", "integration-credentials.json");
  const catalogPath =
    process.env.DASHBOARD_INTEGRATION_CATALOG_PATH ??
    join(workspace, ".dashboard", "integrations.json");
  const localUserTokenPath =
    process.env.DASHBOARD_LOCAL_USER_TOKEN_PATH ??
    join(workspace, ".dashboard", "local-user-token");
  const cardTemplateManifestPath =
    process.env.DASHBOARD_TEMPLATE_MANIFEST_PATH ??
    defaultCardTemplateManifestPath(workspace);
  const cardTemplateClientBuildPath =
    process.env.DASHBOARD_CLIENT_BUILD_PATH ??
    defaultCardTemplateClientBuildPath(workspace);
  // Loopback proves same machine, not same user (D35). The token file does —
  // only the OS account running this process can read it.
  const localUserToken = await provisionLocalUserToken(localUserTokenPath);
  const credentials = createFileCredentialStore(credentialsPath);
  const catalog = createFileIntegrationCatalog(catalogPath);
  const service = createService({
    persistence: createFilePersistence(dashboardPath),
    authStore: createFileAuthStore(authStorePath),
    credentials,
    catalog,
    localUserToken,
    cardTemplateManifestPath,
    cardTemplateClientBuildPath,
  });
  // Internal plumbing for the server's own outbound calls, not a caller-facing
  // operation -- reads the same store `service` composes, directly.
  const tokenProvider: TokenProvider = async (integrationId) => {
    const credential = await credentials.get(integrationId);
    if (!credential) {
      throw new Error(
        `Integration '${integrationId}' is not authorized. Connect it in Settings.`,
      );
    }
    return credential;
  };
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
            body: chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined,
          }),
          service,
        );
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch (error) {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end(error instanceof Error ? error.message : "Invalid request");
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
        response.end(error instanceof Error ? error.message : "Invalid request");
      }
      return;
    }

    if (request.url === "/api/integrations/authorize") {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const result = await handleIntegrationAuthorizeRequest(
          new Request(`http://dashboard${request.url}`, {
            method: request.method,
            headers: authorizationHeaders(request),
            body: chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined,
          }),
          service,
        );
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch (error) {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end(
          error instanceof Error ? error.message : "Authorization failed",
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
            body: chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined,
          }),
          { tokenProvider, service },
        );
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch (error) {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end(
          error instanceof Error ? error.message : "Refresh failed",
        );
      }
      return;
    }

    if (request.url?.startsWith("/r/")) {
      try {
        const result = await handleRegistryRequest(
          new Request(`http://dashboard${request.url}`),
          { manifestPath: cardTemplateManifestPath },
        );
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch (error) {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end(
          error instanceof Error ? error.message : "Registry request failed",
        );
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
  return typeof authorization !== "string"
    ? undefined
    : { authorization };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void startServer();
}

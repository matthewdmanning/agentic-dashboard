const LOCAL_USER_TOKEN_KEY = "dashboard.localUserToken";

/**
 * The local-user token (D35). The server prints a URL carrying it on startup —
 * only the OS account that can see the server's stdout gets that URL — and the
 * page keeps it for later requests. Another OS account on the same host can
 * reach the loopback port but never receives the token, so it proves nothing
 * and resolves to no permissions.
 *
 * Stored per tab in `sessionStorage`, and stripped from the address bar so it
 * does not linger in history or a copied link.
 */
function localUserToken(): string | null {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("token");
  if (fromUrl !== null) {
    sessionStorage.setItem(LOCAL_USER_TOKEN_KEY, fromUrl);
    url.searchParams.delete("token");
    window.history.replaceState(null, "", url);
    return fromUrl;
  }
  return sessionStorage.getItem(LOCAL_USER_TOKEN_KEY);
}

/** Every request to the service carries the token if this page has one. */
export function authorized(init: RequestInit = {}): RequestInit {
  const token = localUserToken();
  if (token === null) return init;
  return {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${token}` },
  };
}

/**
 * Carries the service's own name for a failure, so a caller — the offline queue
 * especially — can tell a denial from a transport problem without reading the
 * message.
 */
export class RequestFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RequestFailure";
  }
}

export async function failureFrom(
  response: Response,
  fallback = `Request failed with ${response.status}`,
): Promise<RequestFailure> {
  const body: unknown = await response.json().catch(() => undefined);
  const { code, message } =
    typeof body === "object" && body !== null
      ? (body as { code?: string; message?: string })
      : {};
  return new RequestFailure(code ?? "invalid-request", message ?? fallback);
}

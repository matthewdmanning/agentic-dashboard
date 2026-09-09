import { ServiceFailure } from "../service";

// One Bearer-header parse shared by every HTTP entry point, imported by both
// the server routes and the registry handler, so neither imports the other.
export function credentialFromRequest(request: Request): string | undefined {
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

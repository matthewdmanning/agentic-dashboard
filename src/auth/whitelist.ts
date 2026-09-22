import type { Account } from "./types";

/**
 * The whole auth provider (see D50 in docs/agents/rationale.json):
 * a fixed, hand-edited mapping from a presented credential to the account it
 * resolves to. A real deployment swaps this file for a proper auth service;
 * nothing downstream of `resolveAccount` needs to change when it does.
 */
const WHITELIST: Readonly<Record<string, Account>> = {
  "dev-owner": { id: "dev-owner", role: "editor" },
};

/** No credential, or one not on the whitelist, resolves to `null` — never a fallback identity. */
export function resolveAccount(credential: string | undefined): Account | null {
  if (!credential) return null;
  return WHITELIST[credential] ?? null;
}

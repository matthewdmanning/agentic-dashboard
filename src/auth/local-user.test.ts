import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

import {
  isLocalUserToken,
  provisionLocalUserToken,
  readLocalUserToken,
} from "./local-user";
import { createService, type DashboardPersistence } from "../service";
import { defaultDashboardConfiguration } from "../contract";

async function tokenPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "local-user-")), "token");
}

function memoryPersistence(): DashboardPersistence {
  let configuration = structuredClone(defaultDashboardConfiguration);
  return {
    read: async () => structuredClone(configuration),
    write: async (next) => {
      configuration = structuredClone(next);
    },
  };
}

describe("local-user token", () => {
  test("writes a token and reads it back", async () => {
    const path = await tokenPath();
    const token = await provisionLocalUserToken(path);

    expect(token).toHaveLength(43); // 32 random bytes, base64url
    await expect(readLocalUserToken(path)).resolves.toBe(token);
    expect((await readFile(path, "utf8")).trim()).toBe(token);
  });

  test("restricts the token to this account, however the platform spells that", async () => {
    const path = await tokenPath();
    await provisionLocalUserToken(path);

    if (process.platform === "win32") {
      // `icacls` should have dropped the inherited entries and left this
      // account as the only one named.
      const { stdout } = await execFileAsync("icacls", [path]);
      const granted = stdout
        .split("\n")
        .flatMap((line) => [...line.matchAll(/([^\s:]+(?:\\[^\s:]+)?):\(/g)])
        .map(([, account]) => account);

      expect(granted.length).toBeGreaterThan(0);
      const username = userInfo().username.toLowerCase();
      for (const account of granted) {
        expect(account.toLowerCase()).toContain(username);
      }
    } else {
      const { mode } = await stat(path);
      expect(mode & 0o777).toBe(0o600);
    }
  });

  test("a fresh token each time, so one does not outlive its process", async () => {
    const first = await provisionLocalUserToken(await tokenPath());
    const second = await provisionLocalUserToken(await tokenPath());
    expect(first).not.toBe(second);
  });

  test("reading a token that was never provisioned is not an error", async () => {
    await expect(
      readLocalUserToken(await tokenPath()),
    ).resolves.toBeUndefined();
  });

  test("matches only the exact token", () => {
    expect(isLocalUserToken("abc", "abc")).toBe(true);
    expect(isLocalUserToken("abc", "abd")).toBe(false);
    expect(isLocalUserToken("ab", "abc")).toBe(false);
    expect(isLocalUserToken(undefined, "abc")).toBe(false);
    expect(isLocalUserToken("abc", undefined)).toBe(false);
    expect(isLocalUserToken(undefined, undefined)).toBe(false);
  });
});

describe("the service's local user", () => {
  test("a caller presenting the token is the local user", async () => {
    const service = createService({
      persistence: memoryPersistence(),
      localUserToken: "secret",
    });

    await expect(service.read("role", "secret")).resolves.toMatchObject({
      name: "localUser",
      permissions: { data: "write", roles: "read" },
    });
  });

  test("loopback alone proves nothing: an unproven caller gets no permissions", async () => {
    const service = createService({
      persistence: memoryPersistence(),
      localUserToken: "secret",
    });

    await expect(service.read("role")).resolves.toMatchObject({
      name: "unauthenticatedUser",
      permissions: { data: "noAccess", cards: "noAccess", roles: "noAccess" },
    });
    await expect(service.read("cards")).rejects.toThrow("cards: read");
  });

  test("a wrong token is not a local user, and is not an account either", async () => {
    const service = createService({
      persistence: memoryPersistence(),
      localUserToken: "secret",
    });

    await expect(service.read("cards", "guess")).rejects.toThrow(
      "Authentication is not configured",
    );
  });

  test("with no token provisioned there is no door, so the caller is local", async () => {
    const service = createService({ persistence: memoryPersistence() });

    await expect(service.read("role")).resolves.toMatchObject({
      name: "localUser",
    });
  });
});

import { describe, expect, it } from "vitest";

import { resolveAccount } from "./whitelist";

describe("resolveAccount", () => {
  it("resolves a whitelisted credential to its account", () => {
    expect(resolveAccount("dev-owner")).toEqual({
      id: "dev-owner",
      role: "editor",
    });
  });

  it("denies a credential not on the whitelist", () => {
    expect(resolveAccount("not-a-real-credential")).toBeNull();
  });

  it("denies no credential at all", () => {
    expect(resolveAccount(undefined)).toBeNull();
  });
});

import { scrypt as deriveKey, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import * as z from "zod/v4";

const scrypt = promisify(deriveKey);
const credentialKeyLength = 64;

const storedAccountSchema = z
  .object({
    user: z.string().min(1),
    role: z.string().min(1),
    salt: z.string().min(1),
    hash: z.string().regex(/^[a-f0-9]{128}$/i),
  })
  .strict();

const accountsSchema = z.array(storedAccountSchema);

/** The identity and role proven by a caller's credential. */
export type Account = {
  user: string;
  role: string;
};

export interface AuthStore {
  resolve(credential: string): Promise<Account | undefined>;
}

/** Derives the persisted credential representation; the credential itself is never returned. */
export async function hashCredential(
  credential: string,
  salt: string,
): Promise<string> {
  const hash = (await scrypt(credential, salt, credentialKeyLength)) as Buffer;
  return hash.toString("hex");
}

/** Encodes an identity as exactly one filesystem-safe, collision-free segment. */
export function encodeUserPathSegment(user: string): string {
  if (user.length === 0) throw new Error("User identity cannot be empty");
  return Buffer.from(user, "utf8").toString("hex");
}

/**
 * Reads accounts on every lookup so the service sees store changes without
 * keeping credential material or role assignments in dashboard data.
 */
export function createFileAuthStore(path: string): AuthStore {
  return {
    async resolve(credential) {
      let accounts: z.infer<typeof accountsSchema>;
      try {
        accounts = accountsSchema.parse(
          JSON.parse(await readFile(path, "utf8")),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return undefined;
        }
        throw error;
      }

      const matches: Account[] = [];
      for (const account of accounts) {
        const expected = Buffer.from(account.hash, "hex");
        const offered = Buffer.from(
          await hashCredential(credential, account.salt),
          "hex",
        );
        if (
          expected.length === offered.length &&
          timingSafeEqual(expected, offered)
        ) {
          matches.push({ user: account.user, role: account.role });
        }
      }

      if (matches.length > 1) {
        throw new Error("Invalid auth store: duplicate credential");
      }
      return matches[0];
    },
  };
}

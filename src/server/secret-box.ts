import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import * as z from "zod/v4";

import { restrictToOwner } from "../auth/local-user";

const algorithm = "aes-256-gcm";
const ivLength = 12;

export const sealedSecretSchema = z
  .object({
    iv: z.string().min(1),
    authTag: z.string().min(1),
    ciphertext: z.string().min(1),
  })
  .strict();

export type SealedSecret = z.infer<typeof sealedSecretSchema>;

/**
 * A per-user secret box (D28, D41): seals a value so only the same `owner`
 * opens it again. One host-held key encrypts for everyone — `owner` is AEAD
 * additional data, not a key-derivation input, so a ciphertext sealed for one
 * user fails `open` under any other user's identity, and tampering with
 * either the ciphertext or the claimed owner is caught by the same GCM auth
 * tag. This is the reusable seam D41 names for #88's connection credentials:
 * same shape, same primitive, any per-user secret a caller must decrypt to
 * use but must not store in the clear.
 */
export interface SecretBox {
  seal(owner: string, plaintext: string): SealedSecret;
  open(owner: string, sealed: SealedSecret): string;
}

export function createSecretBox(key: Buffer): SecretBox {
  if (key.length !== 32) {
    throw new Error("Secret key must be 32 bytes (AES-256)");
  }
  return {
    seal(owner, plaintext) {
      const iv = randomBytes(ivLength);
      const cipher = createCipheriv(algorithm, key, iv);
      cipher.setAAD(Buffer.from(owner, "utf8"));
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      return {
        iv: iv.toString("hex"),
        authTag: cipher.getAuthTag().toString("hex"),
        ciphertext: ciphertext.toString("hex"),
      };
    },
    open(owner, sealed) {
      const decipher = createDecipheriv(
        algorithm,
        key,
        Buffer.from(sealed.iv, "hex"),
      );
      decipher.setAAD(Buffer.from(owner, "utf8"));
      decipher.setAuthTag(Buffer.from(sealed.authTag, "hex"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(sealed.ciphertext, "hex")),
        decipher.final(),
      ]);
      return plaintext.toString("utf8");
    },
  };
}

/** Documented env var name (D41): hex-encoded 32 bytes, read before any file. */
export const secretKeyEnvVar = "DASHBOARD_SECRET_KEY";

/**
 * Resolves the host-held key: `DASHBOARD_SECRET_KEY` if set, else a key
 * persisted at `path`, generated once if neither exists yet. `path` must sit
 * outside the data directory (D41) — `defaultSecretKeyPath` puts it under the
 * OS home directory rather than the workspace.
 *
 * This file decrypts every user's queries (and, once #88 reuses this seam,
 * every connection credential), so it gets the same restriction the
 * local-user token does (`restrictToOwner`, D35): `chmod` 0600 on POSIX,
 * `icacls` on Windows because `chmod` there only maps onto the read-only flag
 * and grants nothing.
 *
 * Generation is exclusive (`flag: "wx"`): two processes racing on a missing
 * file both attempt to create it, but only one create can win. The loser's
 * `writeFile` fails with `EEXIST` rather than overwriting the winner's key —
 * overwriting would silently strand anything already sealed under the
 * winner's key as permanently unopenable. The loser re-reads instead, so both
 * processes end up with the one key that was actually persisted.
 *
 * ponytail: one long-lived key, no rotation. D28's 90-day rotation is #91's
 * job — when it lands, a sealed value needs to name which key it was sealed
 * under, the same way `CredentialStore` will.
 */
export async function resolveSecretKey(path: string): Promise<Buffer> {
  const fromEnv = process.env[secretKeyEnvVar];
  if (fromEnv) return Buffer.from(fromEnv, "hex");

  try {
    return Buffer.from((await readFile(path, "utf8")).trim(), "hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const key = randomBytes(32);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, key.toString("hex"), { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // Lost the race: another process already created it first. Its key is
    // the one everything gets sealed under, so use that instead of ours.
    return Buffer.from((await readFile(path, "utf8")).trim(), "hex");
  }
  await restrictToOwner(path);
  return key;
}

/** Outside the data directory by construction (D41): the OS home directory, not the workspace. */
export function defaultSecretKeyPath(): string {
  return join(homedir(), ".dashboard", "secret.key");
}

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import * as z from "zod/v4";

import { restrictToOwner } from "../auth/local-user";

const algorithm = "aes-256-gcm";
const ivLength = 12;

export const sealedSecretSchema = z
  .object({
    // Names the key this value was sealed under (#91) -- rotation can keep
    // opening a value under its recorded key while a new one takes over for
    // anything sealed from here on.
    keyId: z.string().min(1),
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
 *
 * `seal`/`open` are async, not because this local implementation needs it,
 * but because a hosted deployment cannot hold this key in a host file at
 * all — it must reach a third-party secrets manager instead. A key-custody
 * service could still hand key bytes to hand to `createSecretBox`, but a
 * key-management service (the KMS/Transit shape) never releases key
 * material — it performs the encrypt/decrypt itself, so a remote `SecretBox`
 * is the only way to use one, and that call crosses a network. The signature
 * has to allow that from the start, or every caller needs rewriting the day
 * a remote implementation shows up. Don't "simplify" this back to
 * synchronous.
 */
export interface SecretBox {
  seal(owner: string, plaintext: string): Promise<SealedSecret>;
  open(owner: string, sealed: SealedSecret): Promise<string>;
}

/**
 * Identifies a 32-byte key without exposing it (#91): SHA-256 of the key
 * bytes, truncated. Deterministic, so any process holding the same key bytes
 * agrees on its id without coordinating, and a sealed value's recorded
 * `keyId` can be checked against a ring without ever comparing raw key
 * material.
 */
export function deriveKeyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/**
 * One or more sealing keys (#91, D28): `currentKeyId` names the key `seal`
 * uses for anything new. `keys` holds every key `open` may still need,
 * including one a rotation has not yet fully re-encrypted away from —
 * dropping a key here is what actually destroys it; nothing else references
 * key material once a ring stops carrying it. `currentKeyCreatedAt` is what
 * a rotation check ages against.
 */
export interface SecretKeyRing {
  currentKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
  currentKeyCreatedAt: Date;
}

/** Wraps one key as a ring of one — the shape most callers and every test need, with no rotation in play. */
export function singleKeyRing(
  key: Buffer,
  currentKeyCreatedAt: Date = new Date(),
): SecretKeyRing {
  const keyId = deriveKeyId(key);
  return {
    currentKeyId: keyId,
    keys: new Map([[keyId, key]]),
    currentKeyCreatedAt,
  };
}

/** The ring with `key` added and made current — the shape a completed rotation step produces. Never mutates `ring`. */
export function withNewCurrentKey(
  ring: SecretKeyRing,
  keyId: string,
  key: Buffer,
  createdAt: Date,
): SecretKeyRing {
  return {
    currentKeyId: keyId,
    keys: new Map([...ring.keys, [keyId, key]]),
    currentKeyCreatedAt: createdAt,
  };
}

/** The ring with one retired key dropped — what actually destroys it (#91). Never mutates `ring`, and refuses to drop the current key. */
export function withoutKey(ring: SecretKeyRing, keyId: string): SecretKeyRing {
  if (keyId === ring.currentKeyId) return ring;
  const keys = new Map(ring.keys);
  keys.delete(keyId);
  return { ...ring, keys };
}

export function createSecretBox(key: Buffer): SecretBox;
export function createSecretBox(ring: SecretKeyRing): SecretBox;
export function createSecretBox(source: Buffer | SecretKeyRing): SecretBox {
  const ring = Buffer.isBuffer(source) ? singleKeyRing(source) : source;
  return {
    async seal(owner, plaintext) {
      const key = ring.keys.get(ring.currentKeyId);
      if (!key) {
        throw new Error(`Unknown current sealing key: ${ring.currentKeyId}`);
      }
      const iv = randomBytes(ivLength);
      const cipher = createCipheriv(algorithm, key, iv);
      cipher.setAAD(Buffer.from(owner, "utf8"));
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      return {
        keyId: ring.currentKeyId,
        iv: iv.toString("hex"),
        authTag: cipher.getAuthTag().toString("hex"),
        ciphertext: ciphertext.toString("hex"),
      };
    },
    async open(owner, sealed) {
      const key = ring.keys.get(sealed.keyId);
      if (!key) throw new Error(`Unknown sealing key: ${sealed.keyId}`);
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

/** Documented env var name (D41): hex-encoded 32 bytes, read before any file — bypasses the persisted ring, and its rotation history, entirely. */
export const secretKeyEnvVar = "DASHBOARD_SECRET_KEY";

/** How often the current key is due for rotation (#91, D28): a policy starting point, not a threat-model derivation. */
export const rotationIntervalDaysEnvVar =
  "DASHBOARD_KEY_ROTATION_INTERVAL_DAYS";
export const defaultRotationIntervalDays = 90;

const keyRingFileSchema = z
  .object({
    currentKeyId: z.string().min(1),
    currentKeyCreatedAt: z.iso.datetime(),
    keys: z.record(z.string(), z.string().min(1)),
  })
  .strict();

type KeyRingFile = z.infer<typeof keyRingFileSchema>;

function toKeyRing(file: KeyRingFile): SecretKeyRing {
  return {
    currentKeyId: file.currentKeyId,
    currentKeyCreatedAt: new Date(file.currentKeyCreatedAt),
    keys: new Map(
      Object.entries(file.keys).map(([id, hex]) => [
        id,
        Buffer.from(hex, "hex"),
      ]),
    ),
  };
}

function toKeyRingFile(ring: SecretKeyRing): KeyRingFile {
  return {
    currentKeyId: ring.currentKeyId,
    currentKeyCreatedAt: ring.currentKeyCreatedAt.toISOString(),
    keys: Object.fromEntries(
      [...ring.keys].map(([id, key]) => [id, key.toString("hex")]),
    ),
  };
}

async function readKeyRingFile(path: string): Promise<KeyRingFile | undefined> {
  try {
    return keyRingFileSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
}

/**
 * Persists a ring atomically (temp-then-rename), restricted the same way the
 * local-user token is. Used for an already-existing ring (rotation updates
 * it); the exclusive-create race for a brand new one lives in
 * `resolveSecretKeyRing` instead, the same split `service/queries.ts`'s
 * `writeJson` and `resolveSecretKey`'s generation used to keep.
 */
export async function writeSecretKeyRingFile(
  path: string,
  ring: SecretKeyRing,
): Promise<void> {
  const temporaryPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(toKeyRingFile(ring), null, 2)}\n`,
      { mode: 0o600 },
    );
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  await restrictToOwner(path);
}

/**
 * Resolves the host-held key ring (#91, D28, D41): `DASHBOARD_SECRET_KEY` if
 * set (a single ephemeral key outside rotation, the same override the prior
 * single-key resolver offered), else the ring persisted at `path`, generated
 * with one key if neither exists yet.
 *
 * This file decrypts every user's queries and every connection credential
 * (#88, #91), so it gets the same restriction the local-user token does
 * (`restrictToOwner`, D35): `chmod` 0600 on POSIX, `icacls` on Windows
 * because `chmod` there only maps onto the read-only flag and grants
 * nothing.
 *
 * Generation is exclusive (`flag: "wx"`): two processes racing on a missing
 * file both attempt to create it, but only one create can win. The loser's
 * `writeFile` fails with `EEXIST` rather than overwriting the winner's ring —
 * overwriting would silently strand anything already sealed under the
 * winner's key as permanently unopenable. The loser re-reads instead, so both
 * processes end up with the one ring that was actually persisted.
 */
export async function resolveSecretKeyRing(
  path: string,
): Promise<SecretKeyRing> {
  const fromEnv = process.env[secretKeyEnvVar];
  if (fromEnv) return singleKeyRing(Buffer.from(fromEnv, "hex"));

  const existing = await readKeyRingFile(path);
  if (existing) return toKeyRing(existing);

  const key = randomBytes(32);
  const keyId = deriveKeyId(key);
  const file: KeyRingFile = {
    currentKeyId: keyId,
    currentKeyCreatedAt: new Date().toISOString(),
    keys: { [keyId]: key.toString("hex") },
  };
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // Lost the race: another process already created it first. Its ring is
    // the one everything gets sealed under, so use that instead of ours.
    return toKeyRing((await readKeyRingFile(path))!);
  }
  await restrictToOwner(path);
  return toKeyRing(file);
}

/** Outside the data directory by construction (D41): the OS home directory, not the workspace. */
export function defaultSecretKeyRingPath(): string {
  return join(homedir(), ".dashboard", "secret-keys.json");
}

/** Env vars a hosted deployment sets to point at a managed secrets service instead of the local file (#98, D42). */
export const managedSecretsUrlEnvVar = "DASHBOARD_MANAGED_SECRETS_URL";
export const managedSecretsTokenEnvVar = "DASHBOARD_MANAGED_SECRETS_TOKEN";
const managedSecretsFetchTimeoutMs = 5000;

/**
 * Resolves the key ring from a deployer-configured managed secrets service
 * instead of a local file (#98, D42, extends D28/D41): an HTTPS GET against
 * `url`, optionally bearer-authenticated, expecting the same JSON shape
 * `resolveSecretKeyRing`'s file uses -- no vendor SDK, no key material ever
 * written to disk. Requires `https:` -- both the bearer token and the
 * returned key material would otherwise cross the network in the clear to
 * anyone on-path. `fetchImpl` is injectable for tests, same pattern
 * `google-calendar.ts`'s `FetchCalendar` already uses.
 */
export async function resolveManagedSecretKeyRing(
  url: string,
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<SecretKeyRing> {
  if (new URL(url).protocol !== "https:") {
    throw new Error("Managed secrets URL must use https:");
  }
  const response = await fetchImpl(url, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(managedSecretsFetchTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Managed secrets fetch failed: ${response.status}`);
  }
  return toKeyRing(keyRingFileSchema.parse(await response.json()));
}

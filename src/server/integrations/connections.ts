import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import * as z from "zod/v4";

import { sealedSecretSchema, type SecretBox } from "../secret-box";

/**
 * One user's authorization to one catalog entry (CONTEXT.md's Connection):
 * owns that user's encrypted credential and no shared integration
 * definition. Connecting and disconnecting are the user's by structure and
 * need no permission (D35, D40) — the caller resolved at the one
 * enforcement point (D4) is always the owner, never a payload field.
 */
export interface ConnectionStore {
  get(user: string, catalogEntryId: string): Promise<string | undefined>;
  set(user: string, catalogEntryId: string, credential: string): Promise<void>;
  remove(user: string, catalogEntryId: string): Promise<void>;
  /** Destroys every user's connection to one catalog entry (D40) — what removing the entry itself must do, not just one caller's disconnect. */
  removeAllForEntry(catalogEntryId: string): Promise<void>;
}

/**
 * A connection as it lives on disk: a cleartext envelope — the owning user
 * and the catalog entry it authorizes, neither of which is secret — plus
 * `sealed`, the encrypted credential, which is what D28 protects.
 */
const storedConnectionSchema = z
  .object({
    owner: z.string().min(1),
    catalogEntryId: z.string().min(1),
    sealed: sealedSecretSchema,
  })
  .strict();

type StoredConnection = z.infer<typeof storedConnectionSchema>;

/**
 * The AEAD identity a connection's credential is bound to (#88): both the
 * owning user and the catalog entry it authorizes, composed into
 * `SecretBox`'s one `owner` string. JSON-encoding the pair, rather than
 * joining the two ids with a separator, means neither id can be crafted to
 * bleed into the other — a credential sealed for one user fails to open as
 * another's, and one sealed for one catalog entry fails to open under a
 * different entry, exactly like a wrong owner fails `SecretBox.open` today.
 */
export function connectionIdentity(user: string, catalogEntryId: string): string {
  return JSON.stringify([user, catalogEntryId]);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function readConnections(path: string): Promise<StoredConnection[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed)) {
      throw new Error("Connection store must be an array");
    }
    return parsed.map((entry) => storedConnectionSchema.parse(entry));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return [];
  }
}

/**
 * One encrypted, file-backed store for every user's connections (#88), the
 * same shape as `service/queries.ts`'s store: a cleartext envelope plus a
 * sealed payload, one file for everyone rather than one per user, privacy
 * coming from the seal rather than from which file a row sits in. Same
 * temp-then-rename atomic write as `catalog.ts`.
 */
export function createEncryptedConnectionStore(
  path: string,
  secretBox: SecretBox,
): ConnectionStore {
  return {
    async get(user, catalogEntryId) {
      const connections = await readConnections(path);
      const found = connections.find(
        (connection) =>
          connection.owner === user &&
          connection.catalogEntryId === catalogEntryId,
      );
      if (!found) return undefined;
      return secretBox.open(
        connectionIdentity(user, catalogEntryId),
        found.sealed,
      );
    },
    async set(user, catalogEntryId, credential) {
      const connections = await readConnections(path);
      const sealed = await secretBox.seal(
        connectionIdentity(user, catalogEntryId),
        credential,
      );
      const index = connections.findIndex(
        (connection) =>
          connection.owner === user &&
          connection.catalogEntryId === catalogEntryId,
      );
      const record: StoredConnection = { owner: user, catalogEntryId, sealed };
      if (index === -1) {
        connections.push(record);
      } else {
        connections[index] = record;
      }
      await writeJson(path, connections);
    },
    async remove(user, catalogEntryId) {
      const connections = await readConnections(path);
      const remaining = connections.filter(
        (connection) =>
          !(
            connection.owner === user &&
            connection.catalogEntryId === catalogEntryId
          ),
      );
      await writeJson(path, remaining);
    },
    async removeAllForEntry(catalogEntryId) {
      const connections = await readConnections(path);
      const remaining = connections.filter(
        (connection) => connection.catalogEntryId !== catalogEntryId,
      );
      if (remaining.length === connections.length) return;
      await writeJson(path, remaining);
    },
  };
}

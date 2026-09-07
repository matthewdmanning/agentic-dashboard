import { randomBytes } from "node:crypto";

import { rotateQueryKeys } from "../service/queries";
import { rotateConnectionKeys } from "./integrations/connections";
import {
  createSecretBox,
  deriveKeyId,
  resolveSecretKeyRing,
  withNewCurrentKey,
  withoutKey,
  writeSecretKeyRingFile,
  type SecretKeyRing,
} from "./secret-box";

const millisecondsPerDay = 24 * 60 * 60 * 1000;

export interface KeyRotationPaths {
  keyRingPath: string;
  connectionsPath: string;
  queriesPath: string;
}

export interface KeyRotationResult {
  rotated: boolean;
  ring: SecretKeyRing;
}

/**
 * Rotates the host's sealing key when the current one has aged past
 * `intervalDays` (#91, D28) — otherwise a no-op returning the ring as
 * resolved. No scheduler: this runs once at server startup, the same trigger
 * #89's retention reconciler uses, not a background timer polling on its
 * own.
 *
 * The new key becomes current before either store is touched, so every
 * value this pass re-encrypts lands on it in one step rather than two. Old
 * keys stay in the ring — and connections and queries stay readable under
 * them — until a full pass over both stores confirms nothing references them
 * anymore; a record that fails to re-encrypt simply keeps its old key
 * referenced, which keeps that key alive for the next attempt rather than
 * stranding the record.
 *
 * The ring is persisted twice, and the first write is the one that matters:
 * the new key must survive a crash before any record is sealed under it. A
 * single write at the end of the pass would mean a process killed midway
 * through re-encryption had already written records naming a key that only
 * ever existed in memory — permanently unopenable. Writing first is the
 * recoverable order: a crash then leaves a persisted key that nothing
 * references yet, which the next startup's pass simply prunes.
 */
export async function rotateSecretKeyIfDue(
  paths: KeyRotationPaths,
  intervalDays: number,
  now: Date = new Date(),
): Promise<KeyRotationResult> {
  const ring = await resolveSecretKeyRing(paths.keyRingPath);
  const ageMs = now.getTime() - ring.currentKeyCreatedAt.getTime();
  if (ageMs < intervalDays * millisecondsPerDay) {
    return { rotated: false, ring };
  }

  const newKey = randomBytes(32);
  const newKeyId = deriveKeyId(newKey);
  const rotatedRing = withNewCurrentKey(ring, newKeyId, newKey, now);
  await writeSecretKeyRingFile(paths.keyRingPath, rotatedRing);
  const secretBox = createSecretBox(rotatedRing);

  const [connectionResult, queryResult] = await Promise.all([
    rotateConnectionKeys(paths.connectionsPath, secretBox, newKeyId),
    rotateQueryKeys(paths.queriesPath, secretBox, newKeyId),
  ]);
  const stillReferenced = new Set([
    ...connectionResult.remainingKeyIds,
    ...queryResult.remainingKeyIds,
  ]);

  let finalRing = rotatedRing;
  for (const keyId of ring.keys.keys()) {
    if (keyId !== newKeyId && !stillReferenced.has(keyId)) {
      finalRing = withoutKey(finalRing, keyId);
    }
  }

  await writeSecretKeyRingFile(paths.keyRingPath, finalRing);
  return { rotated: true, ring: finalRing };
}

import { execFile } from "node:child_process";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import * as z from "zod/v4";

import type { JsonSchema } from "./manifest";

const execFileAsync = promisify(execFile);
const tscBin = join(process.cwd(), "node_modules", "typescript", "bin", "tsc");

/**
 * A source file pending a type-check, named by the repo-relative path it
 * will occupy once committed (e.g. `src/client/cards/foo.tsx`).
 */
export interface CardTemplateSourceFile {
  finalPath: string;
  source: string;
}

/**
 * A batch that has already type-checked clean. Nothing is on disk under its
 * tracked paths yet — the caller decides when (`commit`) or whether
 * (`discard`) that happens, so a mutation batch with other work left to do
 * can still unwind cleanly (D39).
 */
export interface PreparedCardTemplateFiles {
  commit(): Promise<void>;
  discard(): Promise<void>;
}

export type CardTemplateTypecheckResult =
  | { ok: true; prepared: PreparedCardTemplateFiles }
  | { ok: false; message: string };

/**
 * Type-checks every source in the batch against the library's real
 * TypeScript types with ONE scoped `tsc --noEmit` run — one rebuild per
 * mutation batch (D39), not one per candidate. There is no per-component
 * prop schema (D22).
 *
 * Each source is written to a temp file beside its tracked path first (same
 * directory, so nothing about module resolution changes between the check
 * and the eventual commit). The scoped tsconfig itself is written under
 * `.local/` (gitignored) rather than next to the real `tsconfig.json`, so a
 * crash mid-check can't leave a stray config file where a broad `git add`
 * would pick it up. It stays inside the repo (unlike an OS temp dir) so
 * `tsc`'s upward `node_modules/@types` search still finds this project's —
 * a config outside the tree fails on `types: ["node"]` alone. Both `extends`
 * and `include` use absolute paths since `.local/` isn't the project root.
 */
export async function typecheckCardTemplateSources(
  sources: readonly CardTemplateSourceFile[],
): Promise<CardTemplateTypecheckResult> {
  const files = await Promise.all(
    sources.map(async (source) => {
      const dir = dirname(source.finalPath);
      await mkdir(dir, { recursive: true });
      const tempPath = join(dir, `__build-${randomUUID()}.tsx`);
      await writeFile(tempPath, source.source);
      return { tempPath, finalPath: source.finalPath };
    }),
  );

  const localDir = join(process.cwd(), ".local");
  await mkdir(localDir, { recursive: true });
  const scopedConfigPath = join(
    localDir,
    `tsconfig.card-templates.${randomUUID()}.json`,
  );
  await writeFile(
    scopedConfigPath,
    JSON.stringify({
      extends: join(process.cwd(), "tsconfig.json"),
      include: files.map(({ tempPath }) => tempPath),
    }),
  );

  try {
    await execFileAsync(
      process.execPath,
      [tscBin, "--noEmit", "-p", scopedConfigPath],
      { cwd: process.cwd() },
    );
  } catch (error) {
    await Promise.all(
      files.map(({ tempPath }) => unlink(tempPath).catch(() => undefined)),
    );
    const stdout = (error as { stdout?: string }).stdout ?? String(error);
    return { ok: false, message: stdout };
  } finally {
    await unlink(scopedConfigPath).catch(() => undefined);
  }

  return {
    ok: true,
    prepared: {
      commit: async () => {
        for (const { tempPath, finalPath } of files) {
          await rename(tempPath, finalPath);
        }
      },
      discard: async () => {
        await Promise.all(
          files.map(({ tempPath }) => unlink(tempPath).catch(() => undefined)),
        );
      },
    },
  };
}

/**
 * A complete card template pending promotion: real registry-item source text
 * (D22) paired with the JSON Schema it must satisfy. `sourceFile` is the bare
 * name recorded in the manifest; `clientSourcePath` is where the client build
 * must resolve the module from (D24).
 */
export interface CardTemplateCandidate {
  name: string;
  title: string;
  sourceFile: string;
  clientSourcePath: string;
  source: string;
  jsonSchema: JsonSchema;
}

export interface CardTemplateBuildPaths {
  manifestPath: string;
  clientBuildPath: string;
}

/**
 * A build that has already validated, compiled its schemas, and type-checked
 * clean. Nothing is at `manifestPath`/`clientBuildPath` yet — the caller
 * decides when (`commit`) or whether (`discard`) that happens, the same
 * two-phase shape `typecheckCardTemplateSources` uses for tracked source, so
 * a mutation batch with other work left to do can still unwind cleanly
 * (D39). Temp files are named per attempt (not derived from `paths`), so a
 * discarded or still-pending prepare never collides with a later one aimed
 * at the same paths.
 */
export interface PreparedCardTemplatePromotion {
  commit(): Promise<void>;
  discard(): Promise<void>;
}

export type CardTemplateBuildResult =
  | {
      ok: true;
      manifest: Record<string, unknown>;
      clientBuild: Record<string, unknown>;
    }
  | { ok: false; stage: "validate" | "schema" | "typecheck"; message: string };

export type PreparedCardTemplateBuildResult =
  | ({ ok: true; prepared: PreparedCardTemplatePromotion } & Pick<
      Extract<CardTemplateBuildResult, { ok: true }>,
      "manifest" | "clientBuild"
    >)
  | Extract<CardTemplateBuildResult, { ok: false }>;

/**
 * Serializes the validate/schema/typecheck/stage work so concurrent builds
 * cannot interleave, and one mutation batch causes at most one rebuild
 * (D39). The queue slot is released once staging finishes — `commit`/
 * `discard` run outside it, since a caller may hold a prepared result open
 * for as long as the rest of its own mutation batch takes.
 */
let buildQueue: Promise<unknown> = Promise.resolve();

/**
 * Validates, compiles JSON Schemas, type-checks, and stages a complete
 * manifest + client build for the given candidates — the one build pipeline,
 * used by both the deferred and immediate entry points below. Returns a
 * `commit`/`discard` pair rather than promoting directly, so a caller that
 * still has other mutations to apply can wait for those to succeed first.
 */
export function prepareCardTemplatePromotion(
  candidates: readonly CardTemplateCandidate[],
  paths: CardTemplateBuildPaths,
): Promise<PreparedCardTemplateBuildResult> {
  const run = buildQueue.then(
    () => stage(candidates, paths),
    () => stage(candidates, paths),
  );
  buildQueue = run.catch(() => undefined);
  return run;
}

/**
 * Convenience entry point for a caller with nothing else to wait for (project
 * initialization, the one candidate set it ever builds): stages and commits
 * immediately. Built on `prepareCardTemplatePromotion` rather than a second
 * implementation of the same pipeline.
 */
export async function promoteCardTemplates(
  candidates: readonly CardTemplateCandidate[],
  paths: CardTemplateBuildPaths,
): Promise<CardTemplateBuildResult> {
  const result = await prepareCardTemplatePromotion(candidates, paths);
  if (!result.ok) return result;
  await result.prepared.commit();
  return { ok: true, manifest: result.manifest, clientBuild: result.clientBuild };
}

async function stage(
  candidates: readonly CardTemplateCandidate[],
  paths: CardTemplateBuildPaths,
): Promise<PreparedCardTemplateBuildResult> {
  const names = candidates.map((candidate) => candidate.name);
  if (new Set(names).size !== names.length) {
    return {
      ok: false,
      stage: "validate",
      message: "Duplicate card template name in candidate set",
    };
  }

  // JSON Schemas are compiled with the installed Zod support (D39) — a schema
  // that doesn't compile fails before anything is written to disk.
  for (const candidate of candidates) {
    try {
      z.fromJSONSchema(candidate.jsonSchema);
    } catch (error) {
      return {
        ok: false,
        stage: "schema",
        message: `${candidate.name}: ${(error as Error).message}`,
      };
    }
  }

  // Checked under `.local/` rather than at `clientSourcePath` itself — this
  // path never commits (every candidate here already has real source on
  // disk, or gets one through a separate mechanism, D22's assembly, out of
  // scope here), and a scratch copy inside `src/` would sit in the way of
  // any other full-project `tsc` run — such as this project's own — that
  // globs `src/**` while this one is still mid-check.
  const checked = await typecheckCardTemplateSources(
    candidates.map((candidate) => ({
      finalPath: join(
        process.cwd(),
        ".local",
        "card-template-check",
        candidate.clientSourcePath,
      ),
      source: candidate.source,
    })),
  );
  if (!checked.ok) {
    return { ok: false, stage: "typecheck", message: checked.message };
  }
  await checked.prepared.discard();

  const manifest = Object.fromEntries(
    candidates.map((candidate) => [
      candidate.name,
      {
        name: candidate.name,
        type: "registry:block",
        title: candidate.title,
        sourceFile: candidate.sourceFile,
        jsonSchema: candidate.jsonSchema,
      },
    ]),
  );
  const clientBuild = {
    templates: candidates.map((candidate) => ({
      name: candidate.name,
      sourceFile: candidate.clientSourcePath,
    })),
  };

  // Staged away from the active generation above, under temp names unique to
  // this attempt (not derived from `paths`) so a prepare that's discarded, or
  // still pending a caller's decision, can never collide with another build
  // aimed at the same paths. Only `commit` renames into the real paths —
  // both together, so manifest and client build are never promoted apart.
  const manifestTempPath = `${paths.manifestPath}.tmp-${randomUUID()}`;
  const clientBuildTempPath = `${paths.clientBuildPath}.tmp-${randomUUID()}`;
  await mkdir(dirname(paths.manifestPath), { recursive: true });
  await mkdir(dirname(paths.clientBuildPath), { recursive: true });
  await writeFile(manifestTempPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    clientBuildTempPath,
    `${JSON.stringify(clientBuild, null, 2)}\n`,
  );

  return {
    ok: true,
    manifest,
    clientBuild,
    prepared: {
      commit: async () => {
        await rename(manifestTempPath, paths.manifestPath);
        await rename(clientBuildTempPath, paths.clientBuildPath);
      },
      discard: async () => {
        await unlink(manifestTempPath).catch(() => undefined);
        await unlink(clientBuildTempPath).catch(() => undefined);
      },
    },
  };
}

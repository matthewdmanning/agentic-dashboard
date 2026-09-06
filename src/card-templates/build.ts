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

export type CardTemplateBuildResult =
  | {
      ok: true;
      manifest: Record<string, unknown>;
      clientBuild: Record<string, unknown>;
    }
  | { ok: false; stage: "validate" | "schema" | "typecheck"; message: string };

/**
 * Serializes builds so concurrent promotions cannot interleave their
 * generated files, and one mutation batch causes at most one rebuild (D39).
 * Each caller still gets its own result — a later call simply waits its turn.
 */
let buildQueue: Promise<unknown> = Promise.resolve();

export function promoteCardTemplates(
  candidates: readonly CardTemplateCandidate[],
  paths: CardTemplateBuildPaths,
): Promise<CardTemplateBuildResult> {
  const run = buildQueue.then(
    () => build(candidates, paths),
    () => build(candidates, paths),
  );
  buildQueue = run.catch(() => undefined);
  return run;
}

async function build(
  candidates: readonly CardTemplateCandidate[],
  paths: CardTemplateBuildPaths,
): Promise<CardTemplateBuildResult> {
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

  // Built away from the active generation above; only now, with a complete
  // successful build in hand, are manifest and client build promoted
  // together (D39) — both temp files are written before either is renamed,
  // so nothing that can fail happens between the two renames.
  await writeJsonAtomicPair(
    { path: paths.manifestPath, value: manifest },
    { path: paths.clientBuildPath, value: clientBuild },
  );

  return { ok: true, manifest, clientBuild };
}

/** Copied from `src/server/integrations/catalog.ts` — the one atomic-write pattern this project uses, extended to promote a pair together. */
async function writeJsonAtomicPair(
  a: { path: string; value: unknown },
  b: { path: string; value: unknown },
): Promise<void> {
  await mkdir(dirname(a.path), { recursive: true });
  await mkdir(dirname(b.path), { recursive: true });
  const aTemp = `${a.path}.tmp`;
  const bTemp = `${b.path}.tmp`;
  try {
    await writeFile(aTemp, `${JSON.stringify(a.value, null, 2)}\n`);
    await writeFile(bTemp, `${JSON.stringify(b.value, null, 2)}\n`);
    await rename(aTemp, a.path);
    await rename(bTemp, b.path);
  } catch (error) {
    await unlink(aTemp).catch(() => undefined);
    await unlink(bTemp).catch(() => undefined);
    throw error;
  }
}

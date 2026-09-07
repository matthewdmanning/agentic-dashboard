import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { promoteCardTemplates, type CardTemplateCandidate } from "./build";

async function temporaryPaths() {
  const dir = await mkdtemp(join(tmpdir(), "card-template-promote-"));
  return {
    manifestPath: join(dir, "manifest.json"),
    clientBuildPath: join(dir, "client-build.json"),
  };
}

const validCandidate: CardTemplateCandidate = {
  name: "note",
  title: "Note",
  sourceFile: "note.tsx",
  clientSourcePath: "src/client/cards/generated/note.tsx",
  source: `import { Card, CardContent } from "@/components/ui/card";

export function NoteCard({ data }: { data: { message: string } }) {
  return (
    <Card>
      <CardContent>{data.message}</CardContent>
    </Card>
  );
}
`,
  jsonSchema: {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"],
    additionalProperties: false,
  },
};

// Real card templates are checked against `@/components/ui/card`'s actual
// types, not a hand-maintained prop schema — `size` only accepts
// `"default" | "sm"`, so this is a genuine `tsc` failure, not a stub.
const typeErrorCandidate: CardTemplateCandidate = {
  ...validCandidate,
  source: `import { Card } from "@/components/ui/card";

export function NoteCard() {
  return <Card size="huge" />;
}
`,
};

const invalidSchemaCandidate: CardTemplateCandidate = {
  ...validCandidate,
  jsonSchema: { type: "not-a-real-type" } as unknown as Record<string, unknown>,
};

describe("promoteCardTemplates", () => {
  it("promotes a valid candidate to the active manifest and client build together", async () => {
    const paths = await temporaryPaths();
    const result = await promoteCardTemplates([validCandidate], paths);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest).toEqual({
      note: {
        name: "note",
        type: "registry:block",
        title: "Note",
        sourceFile: "note.tsx",
        jsonSchema: validCandidate.jsonSchema,
      },
    });
    expect(result.clientBuild).toEqual({
      templates: [
        { name: "note", sourceFile: validCandidate.clientSourcePath },
      ],
    });
    expect(JSON.parse(await readFile(paths.manifestPath, "utf8"))).toEqual(
      result.manifest,
    );
    expect(JSON.parse(await readFile(paths.clientBuildPath, "utf8"))).toEqual(
      result.clientBuild,
    );
  }, 60_000);

  it("leaves the prior generation byte-for-byte active when a candidate fails to type-check", async () => {
    const paths = await temporaryPaths();
    await promoteCardTemplates([validCandidate], paths);
    const priorManifest = await readFile(paths.manifestPath, "utf8");
    const priorClientBuild = await readFile(paths.clientBuildPath, "utf8");

    const result = await promoteCardTemplates([typeErrorCandidate], paths);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("typecheck");
    expect(await readFile(paths.manifestPath, "utf8")).toBe(priorManifest);
    expect(await readFile(paths.clientBuildPath, "utf8")).toBe(
      priorClientBuild,
    );
  }, 60_000);

  it("leaves the prior generation byte-for-byte active when a JSON Schema fails to compile", async () => {
    const paths = await temporaryPaths();
    await promoteCardTemplates([validCandidate], paths);
    const priorManifest = await readFile(paths.manifestPath, "utf8");
    const priorClientBuild = await readFile(paths.clientBuildPath, "utf8");

    const result = await promoteCardTemplates([invalidSchemaCandidate], paths);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("schema");
    expect(await readFile(paths.manifestPath, "utf8")).toBe(priorManifest);
    expect(await readFile(paths.clientBuildPath, "utf8")).toBe(
      priorClientBuild,
    );
  }, 60_000);

  it("serializes concurrent promotions so their generated files cannot interleave", async () => {
    const paths = await temporaryPaths();
    const other: CardTemplateCandidate = {
      ...validCandidate,
      name: "other",
      title: "Other",
      sourceFile: "other.tsx",
      clientSourcePath: "src/client/cards/generated/other.tsx",
    };

    const [first, second] = await Promise.all([
      promoteCardTemplates([validCandidate], paths),
      promoteCardTemplates([other], paths),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    // Whichever call actually promoted last, the manifest and client build
    // on disk must agree with each other — never a name from one call and a
    // sourceFile from the other.
    const manifest = JSON.parse(await readFile(paths.manifestPath, "utf8"));
    const clientBuild = JSON.parse(
      await readFile(paths.clientBuildPath, "utf8"),
    );
    const manifestNames = Object.keys(manifest);
    const clientBuildNames = clientBuild.templates.map(
      (t: { name: string }) => t.name,
    );
    expect(manifestNames).toEqual(clientBuildNames);
    expect(manifestNames).toHaveLength(1);
  }, 60_000);
});

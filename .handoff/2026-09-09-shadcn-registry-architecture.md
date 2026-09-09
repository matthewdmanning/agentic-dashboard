# Handoff: adopting shadcn's registry/MCP architecture (2026-09-09)

Supersedes `.handoff/2026-09-08-mcp-agent-interface-rework.md`, which is now
stale — issue #101 has been **deleted** and its content refiled. Read this one
instead. The old file is still tracked on `main` (commit `9e46f94`); deleting
it is listed under "Not done yet" below.

Two PRs from this session are merged to `main`. Nothing else is started.

## Where this came from

Direct instruction: the existing MCP server and component-building system are
badly flawed, shadcn's already-existing architecture is far superior and must
be used, and the question to answer is **how that architecture incorporates
into the project's other domains — `auth` and `integrations`**.

The referenced docs never arrived in the message. Grounding came from current
shadcn documentation pulled through Context7 (`/docs/mcp`,
`/docs/registry/namespace`, `/docs/components-json`) plus this repo's code.
Worth knowing for anyone re-checking the reasoning: **Context7 has no
documentation at all for the `menuColor` / `menuAccent` fields** — see the open
question below.

## Constraints set this session — do not re-litigate

1. **There is one `components.json`, at the project root.** Users do not get
   their own. Users cannot have custom cards or custom components — card
   templates and the component set are project-owned and identical for
   everyone. What a user owns is runtime appearance (base colour, typeset,
   menu choices, personal presets), expressed as CSS token values through the
   cascade. This overrides D33/D34 and ARCHITECTURE.md:99-106, which still
   document per-user generation; #103 removes it.

2. **Issue #101 is deleted**, refiled as #102-#109 plus #112. A JSON backup of
   its body and comments is at
   `C:\Users\mattm\.claude\plans\issue-101-backup.json` (outside the repo).

3. **`codegen.ts` and `assemble-card-template` stay.** See decision 2 below.
   Do not propose deleting them again.

## Decisions made, with the reasoning

### 1. The duplication audit — what shadcn actually replaces

The governing criterion was _do not duplicate functionality_. The line that
decides every file: **shadcn distributes source; it never authors source.**

| Ours                             | Does                                                                                           | Duplicated by shadcn?                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/server/registry.ts`         | Hand-rolls the registry index + item JSON; derives `registryDependencies` by regex over source | **Yes.** `shadcn` is already a dependency (`^4.21.0`) and ships `registry:build` and `registry:mcp` for exactly this |
| `src/card-templates/codegen.ts`  | Composition tree → TSX source                                                                  | **No.** shadcn has no authoring step                                                                                 |
| `src/card-templates/build.ts`    | Scoped `tsc --noEmit` gate, then atomic commit/discard                                         | **No.** `shadcn add` writes files; it does not type-check them                                                       |
| `src/card-templates/manifest.ts` | Pairs each template with the JSON Schema its card data must satisfy                            | **No.** A registry item carries no data schema                                                                       |
| `assemble-card-template` (MCP)   | Runtime authoring gated by `cards: write` through the service                                  | **No.** shadcn's install path has no permission model                                                                |

### 2. `codegen.ts` / `assemble-card-template` are kept

Deleting them removes a capability shadcn does not provide. They are the only
way a non-repo caller — an `admin` at runtime, over the service, per
ARCHITECTURE.md:63-66 — can bring a new card template into existence.
Everything shadcn adds sits _downstream_ of authoring.

What changes is codegen's **output boundary**: it produces a registry item,
which shadcn's own tooling then serves and installs.

### 3. A shadcn registry is not an integration

This is the direct answer to the original question, and it is deliberately a
negative one.

`integrations` owns per-user connections to external **data** services that
feed card state, each authorized by the user who owns it. A registry supplies
**source code** for a component set identical for everyone. It belongs in the
same class as `style`, `iconLibrary` and `tailwind.cssVariables`:
project-owned configuration in the one root `components.json`, changed by
repository access and review — not by an application role, and never through
Settings.

The only thing `integrations` lends is the secret seam, and only because
ARCHITECTURE.md:144 already makes that universal: a private registry's token is
stored through `CredentialStore` like every other secret and injected into the
environment at CLI invocation, so `components.json` carries a `${VAR}`
placeholder and never a credential.

So the incorporation into `integrations` is **nothing**. That is the answer,
not an omission.

### 4. The auth answer: gate `/r/*` at the one enforcement point

The project sits on **both** sides of shadcn's registry protocol, and the two
put auth in opposite places:

- **Provider** — this dashboard serves a registry. Auth belongs on the route.
  Shipped, see below.
- **Consumer** — this dashboard installs from registries. Auth belongs in
  `components.json` headers with `${ENV}` expansion. Not started (#105).

The client half of the provider direction needs no new code: a `@dashboard`
namespace pointing at `http://127.0.0.1:5173/r/{name}.json` with
`headers: { "Authorization": "Bearer ${DASHBOARD_TOKEN}" }`, using the
local-user token the server already provisions and prints
(`src/server/index.ts:425,701`).

### 5. Seam rule for `card-templates` → `service`

Established while reverting a change, and it constrains #112:

`generateComponentSource(tree, componentName)` must **not** grow a third
parameter carrying the component map. Doing so widens the interface to do the
same work and leaks codegen's internal lookup table — where components live on
disk — across a module boundary that previously hid it. `service` should not
learn that codegen needs a filesystem scan.

The `build.ts` precedent does not license it: `prepareCardTemplatePromotion`
takes a batch of _candidates_, which is the caller's own data. A component map
is not.

## What shipped

Both merged to `main`, history preserved (no squash):

- **PR #110 → `6401d92`** (`fix(server): gate the registry route through the
service`), closes #102. `/r/*` was the only HTTP route with no auth check —
  it built its `Request` with no headers while every `/api/*` route passes
  `authorizationHeaders(request)`, and since a registry item carries the full
  source text of its card template, that was source disclosure to any OS
  account on the host. Now gates on `cards: read` via
  `service.read("cards", credential)` before any manifest or file read, so
  `requireRead` decides and no second check exists. `credentialFromRequest`
  moved to `src/server/credential.ts` to break the import cycle the fix
  otherwise created between the entrypoint and a leaf route module.

- **PR #111 → `99d8307`** (`fix(appearance): emit menu colour and accent as
cascade tokens`), closes #109. Five custom properties
  (`--menu-background`, `--menu-foreground`, `--menu-border`, `--menu-accent`,
  `--menu-accent-foreground`) emitted from `tokenSetCss` so both the preset and
  base-colour paths carry them, declared under both `:root` and `.dark`.

`main` is at `99d8307`. 268 tests pass.

## Issue map

Open, with blocking edges as native GitHub dependencies:

| #    | Title                                                                                | Blocked by               |
| ---- | ------------------------------------------------------------------------------------ | ------------------------ |
| #103 | Drop per-user components.json generation                                             | — (was #109, now merged) |
| #104 | Replace hand-rolled registry serving with shadcn's `registry:build` / `registry:mcp` | #103                     |
| #105 | Project-owned registry namespaces in components.json                                 | #103                     |
| #106 | The theme system has no accent hue anywhere                                          | —                        |
| #107 | Registry and CardView drift                                                          | —                        |
| #108 | MCP tool descriptions and agent-onboarding doc fixes                                 | —                        |
| #112 | Component-source resolution blocks the event loop                                    | —                        |

Closed this session: #102, #109. Deleted: #101.

Pre-existing and directly related: **#80** (expose the shadcn skill pack to
agents authoring card templates) — it covers the same discovery ground as #108
and as the unfiled `list-components` question below. Read it before planning
either; it already weighs an MCP tool vs. an HTTP route beside `/r/*` vs. a
tool-description pointer, and warns that the pack is vendored so copying it
into `src/` creates a second copy that drifts.

## Open — needs the user, do not assume

1. **`list-components` was never filed.** The old handoff's plan item 1 was a
   tool exposing what is installed in `src/components/ui`. The reasoning this
   session was that it _narrows but does not die_ — shadcn's `view`/`search`
   read registries over HTTP, not what is installed here, and no documented
   shadcn command answers "what is installed in this project." But #108 carries
   only the old items 2, 3 and 4, so nothing tracks it. Either file it or
   decide it dies. Overlaps #80.

2. **The menu treatment-to-token mapping in `99d8307` is a judgement call, not
   a derivation.** Context7 has no shadcn documentation for `menuColor` or
   `menuAccent`; the only authority is this repo's own comment at
   `src/contract/index.ts:167` calling them "shadcn's own supported menu-colour
   treatments (#95)". `default`/`inverted` map to `--popover` /
   `--popover-foreground` swapped, the `*-translucent` pair adds
   `color-mix(... 85%, transparent)`, and `subtle` tints `--accent` 60% toward
   the menu surface. If the intended semantics differ, that mapping is the
   thing to change — it is already merged.

3. **Local `main` has not been fast-forwarded.** `origin/main` is at
   `99d8307`. The merged branches `issue-102-gate-registry-route` and
   `issue-109-menu-appearance-tokens` still exist locally and remotely.

## Not done yet, from the approved plan

- Delete `.handoff/2026-09-08-mcp-agent-interface-rework.md`. It is stale and
  describes a deleted issue. It landed on `main` inside PR #110 because it was
  already an ancestor commit on that branch; commit `0be0666` only ran prettier
  over it so CI would pass.
- Propagate to `ARCHITECTURE.md` (module map, service surface, the registry
  paragraph at line 108, the drift note at 83-89, and the user/project
  ownership split at 99-106) and retire D33/D34 in
  `docs/agents/rationale.json`. This belongs with #103.

## Traps — read before running anything

**Do not create a git worktree with a junctioned `node_modules`.** This cost
two incidents:

1. Cleaning up such a worktree with `Remove-Item -Recurse -Force` followed the
   junction and deleted through it into the real `node_modules`, destroying
   `.bin` and `@base-ui`.
2. Worse and less obvious: every `npm run` / `npx` executed with that worktree
   as cwd operates on the real `node_modules` through the link, and pruned it a
   second time. A stray verification run there also produced five "failed test
   files" that were entirely environmental.

Recovery is `npm install` (not `npm ci` — that fails with `EPERM` on
`lightningcss.win32-x64-msvc.node` while any dev server holds it). To remove a
junction safely use `cmd /c rmdir <link>`, which deletes the link and never the
target.

**To verify a specific commit while the tree is dirty**, stash only the
unrelated files in the main working tree and run there. That is the approach
that worked.

Also note: a dashboard dev server was already listening on port 5173 for this
whole session, owner unknown, not killed.

## Reverted, with reasoning — do not restore blindly

An uncommitted change was in the tree at session start from a previous session:
`componentSourceFiles()` made async and exported as
`resolveComponentSourceFiles()`, with `generateComponentSource` made pure by
taking the map as a third parameter and `service` resolving it once per batch.

**The async half is right and is now #112. The third parameter is why it was
reverted** — see decision 5. It is preserved at
`refs/backup/codegen-async-refactor` (`d925733`): worth reading, not worth
cherry-picking.

## Backup refs

Local only, never pushed:

| Ref                                  | Commit    | Holds                                     |
| ------------------------------------ | --------- | ----------------------------------------- |
| `refs/backup/codegen-async-refactor` | `d925733` | The reverted refactor above               |
| `refs/backup/pre-shadcn-rework`      | `b9aff46` | Working tree at session start             |
| `refs/backup/post-102`               | `728042a` | Working tree after the #102 work          |
| `refs/backup/pre-109-verify`         | `0af8520` | Working tree before the #109 verification |
| `refs/backup/pre-issue-commits`      | `3b4029e` | Pre-existing, not from this session       |

## Do not redo

- The 15-of-28 table-driven MCP mutation tools (`mutationSchema.options` +
  `mutationToolDescriptors` in `mcp/server.ts`) — merged in `38c2d73`.
- Deployment model: stays local stdio. Remote/cloud access was explicitly
  ruled out in an earlier session.
- Tool pattern: stays one-tool-per-action. 28 tools, nobody has complained
  about the list size.
- Tools, not Resources, for any new discovery capability — the agent must
  decide when to fetch, and no confirmed host here reliably auto-loads
  resources.

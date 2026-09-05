# Implementation spec — decided and unbuilt

## Status

What D22–D38 decided and the tree does not yet do. Every requirement here traces
to a decision in [`architecture-decisions.md`](architecture-decisions.md); where
this document and that one disagree, that one wins. Terms are defined in
[`CONTEXT.md`](../CONTEXT.md) and not redefined here.

Three phases, ordered by dependency. Phase 1 stands alone. Phases 2 and 3 both
need the user identity Phase 2 introduces, so Phase 3 follows Phase 2.

Each phase is done when its acceptance checks pass and `npm run check` is green.

## Conventions this spec settles

Two things the decisions imply without naming. Neither is a new decision; both
follow the pattern already in `.dashboard/`.

- **A user's identity is a name on their account.** `accountSchema` gains a
  `user` field; the local user's name is the OS account running the server
  (D35). Nothing mints ids — how accounts are created stays out of scope (D2).
- **Per-user files live under `.dashboard/users/<user>/`**, beside the existing
  workspace stores, overridable by environment variable like every other path
  in `src/server/index.ts:216-228`. This is where D27's env file and D34's
  generated `components.json` go.

---

## Phase 1 — A dashboard that renders again

D22, D24, D25, D32. No identity dependency; ship first because the product
currently renders nothing.

### 1.1 The assembler emits a registry item

`assemble-card-template` produces a shadcn registry item — `name`, `type`,
`files`, `dependencies`, `registryDependencies` — not a bare `.tsx` (D32). The
assembler's output and what `/r/<name>.json` serves become one artifact in one
shape.

- `generateComponentSource` (`src/card-templates/codegen.ts:16`) hardcodes an
  import from `react-aria-components`. Imports are derived from the composition
  tree instead, against shadcn: a component resolves to `@/components/ui/<name>`.
- `deriveDependencies` (`src/server/registry.ts:63`) already derives both
  dependency lists from source text. The assembler uses that function rather
  than growing a second copy; it moves somewhere both can import.
- Correctness stays `tsc --noEmit` against shadcn's real types (D22). No
  per-component prop schema.
- Scope is unchanged: static trees only. Local state, hooks, and drag-and-drop
  stay hand-written.

**Acceptance.** An `assemble-card-template` call returns an item that
`/r/<name>.json` serves byte-for-byte from the file it wrote, and a shadcn-aware
client can `add` it.

### 1.2 `react-aria-components` leaves

Removed from `package.json` and from every import, doc string, and MCP tool
description (`src/mcp/server.ts:145`, `src/contract/index.ts:117`,
`src/server/registry.ts:25`). Pre-alpha: deleted, not deprecated (D32).

`@base-ui/react` stays — this dashboard chose the `base-nova` preset and
`src/components/ui/{badge,button,separator}.tsx` import it directly.

### 1.3 Card templates exist again

At least one hand-written shadcn card template, registered in all three places
that must agree — `cardTemplateSchemas` (`src/contract/card-templates.ts`),
`includedCardTemplates` and `cardTemplateSourceFiles`
(`src/client/cards/index.ts`) — and named by a card in
`defaultDashboardConfiguration`.

- Composes shadcn components directly. No structural layer beneath them (D25).
- Every colour is a semantic token. No hex literal, no palette-scale utility
  (`bg-neutral-800`, `text-blue-500`) anywhere in its source (D26).

**Acceptance.** A freshly initialized dashboard renders a card. The registry
index is non-empty. A grep of the template's source finds no hex literal and no
palette-scale utility.

---

## Phase 2 — Users, queries, and secrets

D28, D29, D30, D31, D32, D35. Introduces the user dimension the code has
nowhere today: `auth` resolves a credential to a role and stops there.

### 2.1 Accounts carry a user

`accountSchema` (`src/auth/index.ts:4`) becomes `{user, credential, role}`, and
`AuthStore.resolve` returns that user alongside the role. The one enforcement
point resolves account, then user and role, on every call (D4).

### 2.2 Queries move to user data

A card carries no queries (D32). `cardSchema.queries`
(`src/contract/index.ts:146`) is deleted; a query is stored with the user who
supplied it, in a per-user store the service owns.

- A user's own queries are not governed by the permission matrix (D35). No
  category, no level — the storage boundary is the whole enforcement.
- `admin` may delete another user's queries. Nothing else reaches them: not
  read, not edit (D32).
- `read` gains the caller's own queries as a scope, ungated, alongside
  `read("role")`.
- D31's privacy becomes structural: no shared object holds another user's
  queries, so nothing is filtered on read.
- Results stay shared. Last write wins on a card two users' queries both feed,
  with a `ponytail:` comment naming the ceiling (D30).

**Acceptance.** Two users each supply a query against the same card. Each reads
only their own. Both results reach the card, and every user sees both.

### 2.3 Card mappers move into a shared store

D38. `formatter` is renamed and rehomed in the same pass, since both touch every
line that reads a query.

- `formatterSpecSchema` becomes `cardMapperSpecSchema`, and
  `compileFormatterSpec` (`src/contract/index.ts:483`) becomes
  `compileCardMapper`. `src/client/formatters/identity.ts` moves with them. The
  grammar itself is unchanged.
- `querySchema.formatter` (`src/contract/index.ts:136`) stops holding a spec and
  holds a mapper's name instead. The spec lives once, in the store.
- `dashboardConfigurationSchema` gains the store, alongside `cards` and `themes`
  — it is shared, so it belongs to dashboard configuration rather than user data.
- Mutations to add, edit, and remove one. Adding is ungated, like supplying a
  query; adding under a name already present fails rather than overwriting.
  Editing and removing take `cards: write` (D35), because other users' cards
  reference what changes.
- Refresh (`src/server/integrations/index.ts:84`) resolves the name against the
  store before compiling.

**Acceptance.** Two queries naming one mapper produce the same reshaping from one
stored spec. Adding a duplicate name fails. A `user` adds a mapper and cannot
edit another's.

### 2.4 Refresh runs under each query's owner

`TokenProvider` (`src/server/integrations/index.ts:15`) takes the user as well
as the connection, and `refreshCardQueries` fires each query under its owner's
secret (D30). The seam gains a dimension rather than being replaced.

### 2.5 Account credentials are hashed

`crypto.scrypt` derives, `crypto.timingSafeEqual` compares (D28). The auth store
holds a hash and salt, never a credential. This closes the `ponytail:` comment
at `src/auth/index.ts:45`. No dependency added.

### 2.6 Integration tokens are encrypted at rest

Behind `CredentialStore` (`src/server/integrations/credentials.ts`), which stays
the single seam (D28):

- AES-256-GCM, key held outside the data directory, on the server host (D30).
- Keyed by user and connection, not connection alone.
- Each stored token names the key it was sealed under, so a rotation needs no
  flag day.
- Rotation every 90 days re-encrypts every token; an old key is destroyed once
  nothing references it.
- Decrypted in memory at request time, never written back in the clear.

**Acceptance.** A token written before a rotation is still readable while the
re-encryption pass runs. The store's file holds no plaintext secret.

### 2.7 Integration authorization needs no permission

Connecting and disconnecting a user's own account is theirs by structure (D35).
Adding, removing, or redefining the integration itself stays `integrations`
`write`. `user` holds `integrations: read` and can still connect.

---

## Phase 3 — Appearance

D26, D27, D33, D34. Needs Phase 2's user identity, since every setting here is
per-user.

### 3.1 `themeSchema.settings` gets a shape

`z.record(z.string(), z.unknown())` (`src/contract/index.ts:76`) is replaced by
what D33 settled: a typeset — `--typeset-size`, `--typeset-leading`,
`--typeset-flow`, `--typeset-font-body`, `--typeset-font-heading`,
`--typeset-font-mono` — plus the presentational fields of `components.json`:
`style`, `tailwind.baseColor`, `tailwind.cssVariables`, `iconLibrary`, `rtl`,
`menuColor`, `menuAccent`. Nothing else. A theme reaches no structural field.

### 3.2 `fontScale` is deleted

Replaced by `--typeset-size` (D33), so it goes rather than sitting beside it:
the `dashboardConfigurationSchema` field, `set-font-scale` and its entry in
`mutationRequirements`, its MCP tool, its Settings control, and
`ReadScopes.presentation.fontScale` (`src/service/index.ts:71`).

### 3.3 Per-user configuration is read from the user's own env file

Base colour and typeset selection are read from `.dashboard/users/<user>/.env`,
not from dashboard configuration, which stays shared (D27). Secrets never go
there (D28).

### 3.4 `components.json` is per-user and generated

One shared `components.json` today becomes one per user, generated by extending
a server-owned template (D34):

- The template holds the structural fields — `aliases`, `rsc`, `tsx`,
  `tailwind.config`, `tailwind.css`, `tailwind.prefix`, `registries`, `$schema`.
- The user's extension holds the presentational ones from 3.1.
- Regenerated on change, never patched: `style`, `tailwind.baseColor`, and
  `tailwind.cssVariables` cannot be altered after initialization.
- A user cannot reach a structural field because their file does not hold one.

### 3.5 Presets

A preset is a whole token set in `globals-example.css` format — the
`@theme inline` mapping, `:root` and `.dark` blocks defining every token as an
`oklch(...)` value, the `@layer base` rules — never a partial override (D27).

- `admin` adds presets available to everyone (D26, D35).
- A user adds their own, ungated.
- Generation is build-time only, at initialization or preset-apply. Nothing
  generates a token value at runtime.

**Acceptance.** Two users open the same card showing the same data and see two
base colours. Changing a base colour recolours every card without any card's
source changing. No token value is computed at request time.

---

## Out of scope

Not in these phases, and not open questions:

- Grid placement — the dashboard's ordering stays flat (D9).
- Drag-and-drop and any card template needing local state, through the assembled
  path (D22).
- More than one dashboard (D21).
- Google Drive backup and restore, and external-service write-back — product
  scope, unaddressed by this round of decisions.

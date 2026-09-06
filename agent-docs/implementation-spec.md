# Implementation spec — decided and unbuilt

## Status

What D22–D38 decided and the tree does not yet do. Every requirement here traces
to a decision in [`architecture-decisions.md`](architecture-decisions.md); where
this document and that one disagree, that one wins. Terms are defined in
[`CONTEXT.md`](../CONTEXT.md) and not redefined here.

Three phases, ordered by dependency. Phase 1 stands alone. Phase 2 introduces
the user identity, connections, and integration catalog that Phase 3 needs.

Each phase is done when its acceptance checks pass and `npm run check` is green.

## Conventions this spec settles

Two things the decisions imply without naming. Neither is a new decision; both
follow the pattern already in `.dashboard/`.

- **A user's identity is a name on their account.** `accountSchema` gains a
  `user` field; the local user's name is the OS account running the server
  (D35). Nothing mints ids — how accounts are created stays out of scope (D2).
  A user name is encoded as one filesystem segment before it is used in a path;
  raw account input never participates in path resolution.
- **Per-user files live under `.dashboard/users/<user>/`**, beside the existing
  workspace stores, overridable by environment variable like every other path
  in `src/server/index.ts:216-228`. This is where D27's env file and D34's
  generated `components.json` go.

---

## Phase 1 — Initial templates and rebuild-on-reload

D22, D24, D25, D32, D37, D39. No identity dependency.

### 1.1 Initialization creates one active template generation

Project initialization generates the project-owned shadcn/ui configuration, at
least one default card template, its JSON Schema, an active template manifest,
and a client build. The manifest is the single source of truth for both
rendering and the shadcn registry.

The default template composes shadcn components directly and uses semantic
colour tokens only. A freshly initialized dashboard names it and renders a
card; the registry index is non-empty and serves the same item.

### 1.2 The card-template build module publishes atomically

One module owns candidate validation, type-checking, client building, and
atomic promotion. Its interface accepts a complete candidate set of registry
items paired with JSON Schemas and either returns the promoted generation or
fails without changing the active one.

- JSON Schemas are compiled with the installed Zod JSON Schema support; no
  validator dependency is added.
- Generated component source is checked against shadcn's real TypeScript types.
  There is no per-component prop schema.
- Client assets and the manifest are built into a candidate location and
  promoted together only after the complete build succeeds.
- Builds are serialized. One mutation batch causes at most one rebuild.
- Open pages keep the generation they loaded. The next full reload receives the
  promoted build; there is no hot module replacement contract.

### 1.3 An admin assembles a complete card template

`assemble-card-template` requires `cards: write` and accepts a name, mandatory
JSON Schema, and static composition tree. It produces a shadcn registry item,
adds it to the candidate template set, waits for the rebuild, and returns only
after successful promotion.

Imports and dependency lists are derived from the composition. Scope remains
static trees: local state, hooks, and drag-and-drop stay hand-written.

**Acceptance.** After a successful call, the existing page is unchanged and a
reload can render the new template. The registry serves the promoted item
byte-for-byte. A failed JSON Schema, type-check, or full build leaves the prior
generation active and returns a named failure.

### 1.4 `react-aria-components` leaves

Remove the package and every import or description that presents it as the
composition library. `@base-ui/react` stays because it is part of the current
`base-nova` shadcn output.

---

## Phase 2 — Users, queries, and secrets

D28, D29, D30, D31, D32, D35. Introduces the user dimension the code has
nowhere today: `auth` resolves a credential to a role and stops there.

### 2.1 Accounts carry a user

`accountSchema` (`src/auth/index.ts:4`) becomes `{user, credential, role}`, and
`AuthStore.resolve` returns that user alongside the role. The one enforcement
point resolves account, then user and role, on every call (D4).

User-owned operations derive the user from the resolved account; their payloads
never select another user. Their mutation requirement is ownership rather than a
permission category. An administrative operation against another user's data is
a separate, explicitly role-gated mutation.

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
only their own query. Each refresh may update the shared card, and whichever
refresh writes last is the one state every user sees.

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
- Mutations add, edit, and remove one. Adding records the resolved user as its
  owner and is not permission-gated. Adding under a name already present fails
  rather than overwriting.
- An owner may edit or remove their unreferenced mapper. Changing a mapper with
  references takes `cards: write`; removing any referenced mapper fails with
  `in-use`, including for an administrator. Removal never cascades into private
  queries.
- Refresh (`src/server/integrations/index.ts:84`) resolves the name against the
  store before compiling.

**Acceptance.** Two queries naming one mapper produce the same reshaping from one
stored spec. Adding a duplicate name fails. A `user` adds a mapper and cannot
edit another user's mapper. Removing a referenced mapper returns `in-use`.

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

### 2.7 The integration catalog is file-backed project state

The shared catalog replaces the dashboard configuration's undifferentiated
integration array. Each entry contains non-secret connection information, its
default, recommended, or dynamic origin, and its available or blocked status.
Initialization seeds the default and recommended entries from a project-owned
file.

Project policy includes `unusedIntegrationRetentionDays`, initially 30.
Changing it takes `integrations: write`. Default and recommended entries do not
expire. A dynamic entry with no connections is stamped unused and expires after
the configured period. Cleanup runs at startup and when connections change; no
background scheduler is introduced.

### 2.8 Connections are private credential handoffs

Connecting and disconnecting a user's own account is theirs by structure and
needs no permission. Both operations resolve the user from the caller and live
outside the general mutation and offline-queue formats.

A connection is keyed by user and catalog entry. Disconnecting destroys its
credential immediately. A catalog entry with zero connections remains readable
according to its origin and retention policy.

### 2.9 Administrators block and remove integrations

Blocking takes `integrations: write`, immediately prevents new connections and
query refreshes, and retains the catalog entry, queries, connections, and
encrypted credentials. Every affected user sees a persistent blocked notice.

Removing also takes `integrations: write`. With no dependencies it removes the
entry directly. With connections or queries, Settings first shows a high-level
warning containing counts and effects but no private user, query, or credential
details. An explicit override removes the entry and every stored credential.
Private queries remain but become unavailable, and their owners see a
persistent notice.

**Acceptance.** A user can connect to a recommended entry, disconnect, and see
their credential disappear while the entry remains. A blocked entry cannot
connect or refresh and produces a persistent notice. An administrator can
override the dependency warning; credentials are deleted and queries are not.

---

## Phase 3 — Appearance

D26, D27, D33, D34. Needs Phase 2's user identity, since every setting here is
per-user.

### 3.1 Project and user appearance get separate schemas

The project-owned component-library schema carries every field that changes
generated source: `style`, `tailwind.cssVariables`, `iconLibrary`, and
`rtl`, together with aliases and build paths. A user cannot mutate one of
these fields.

The user preference schema carries:

- base colour or personal colour preset selection
- `--typeset-size`, `--typeset-leading`, `--typeset-flow`,
  `--typeset-font-body`, `--typeset-font-heading`, and
  `--typeset-font-mono`
- `menuColor`: `default`, `inverted`, `default-translucent`, or
  `inverted-translucent`
- `menuAccent`: `subtle` or `bold`

These are closed schemas. User appearance never accepts arbitrary CSS.

### 3.2 `fontScale` is deleted

Replaced by `--typeset-size` (D33), so it goes rather than sitting beside it:
the `dashboardConfigurationSchema` field, `set-font-scale` and its entry in
`mutationRequirements`, its MCP tool, its Settings control, and
`ReadScopes.presentation.fontScale` (`src/service/index.ts:71`).

### 3.3 Per-user configuration is read from the user's own env file

Base colour, typeset, menu colour, menu accent, and personal preset selection
are read from `.dashboard/users/<user>/.env`, not from dashboard configuration,
which stays shared (D27). Secrets never go there (D28). The user path uses the
encoded identity from Phase 2.

### 3.4 `components.json` is per-user and generated

One shared `components.json` today becomes one generated file per user (D34).
Generation copies the project-owned template and overlays only that user's
allowed runtime choices. It replaces the complete file and rejects any attempt
to alter a project-owned field.

### 3.5 Presets

A preset is a whole token set in `globals-example.css` format — the
`@theme inline` mapping, `:root` and `.dark` blocks defining every token as an
`oklch(...)` value, the `@layer base` rules — never a partial override (D27).

- A role with `presentation: write` adds presets available to everyone.
- Every user can list the server-owned presets.
- A user adds and selects their own presets without a permission check.
- Menu colour and accent choices may be saved personally or selected from the
  server-owned list, always using the closed values in 3.1.
- Generation is build-time only, at initialization or preset-apply. Nothing
  generates a token value at runtime.

**Acceptance.** Two users open the same card showing the same data and see their
own base colour, typeset, menu colour, and menu accent. Changing a base colour
recolours every card without any card's source changing. Neither user can change
`style`, `iconLibrary`, `rtl`, or `tailwind.cssVariables`. No token value
is computed at request time.

---

## Out of scope

Not in these phases, and not open questions:

- Grid placement — the dashboard's ordering stays flat (D9).
- Drag-and-drop and any card template needing local state, through the assembled
  path (D22).
- More than one dashboard (D21).
- Google Drive backup and restore, and external-service write-back — product
  scope, unaddressed by this round of decisions.

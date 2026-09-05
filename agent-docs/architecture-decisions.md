# Architecture decisions — grilling session, 2026-08-31

## Status

**Work in progress. Deliberately ahead of the codebase.**

This document does not need to agree with the code, and a disagreement is not a bug to fix here. The code describes what exists; this document describes what was decided.

`ARCHITECTURE.md` and `CONTEXT.md` have caught up — both were rewritten to these decisions in `cd8e98e` (#65), so they now describe the target rather than the tree. `ARCHITECTURE.md` carries a "Rewrite in progress" section mapping each module to what is actually in `src/` today.

**When planning, this document is the authoritative source of truth.** Where it conflicts with anything else, it wins.

Every item is settled. Nothing here is open.

D19 and D20 were decided on 2026-09-01, after the session, while `service` was being written for #60. They are recorded here because this document is where decisions live, not because the session reopened.

Scope of this session: the contracts between parts of the application. Vocabulary changes: `role`, `account`, `mutation`, and `query` are added; `source`, `wiring`, and `style` are deleted. Everything else is a term already in `CONTEXT.md`.

Decisions are recorded as they were settled. The application is pre-alpha and non-functional: nothing is released, no stored data belongs to anyone, and nothing depends on current behaviour. So no decision here is constrained by back-compat, gradual migration, deprecation windows, or avoiding a name clash with what exists. Where a decision replaces something, the old thing is deleted outright.

---

## Decisions

### D1 — One service interface; client and MCP are peers over it

The service exposes one interface. The client and the MCP server are two consumers of that same interface, with no privileged path between them.

Rejected: MCP reaching persistence through a shared library, or MCP owning its own copy of persistence and path-containment logic. Both produce more than one door to the same file, and a permission or authentication check on one door does not cover the other.

Consequence: the MCP server cannot run without the service process.

### D2 — Role is a named bundle of permissions

`role` enters the vocabulary with its ordinary meaning in authentication: a named set of permissions, bundled together and assigned to an account.

`account` enters the vocabulary as the identity a caller presents. How accounts are created and how a role is assigned to an account is out of scope for this session.

There is no separate "developer" and "user" concept in the architecture. What distinguishes those two kinds of work is which door the change goes through, not which role holds it:

- changes to dashboard configuration go through the service, governed by a role
- changes to card templates, built-in formatters, and packages are source changes, reviewed like any other code change, and are not reachable through the service at any permission level (D22 narrows this: assembling a card template's component from a declarative composition tree is one specific service capability, gated by a permission level like any other mutation — built-in formatters and packages are untouched)

### D3 — Roles live in dashboard configuration; accounts live in the auth store

Split at the credential line:

- **Roles** — name plus permission bundle — live in dashboard configuration. They carry no credential. (D19 removed "and are edited through Settings": roles are changed at source.)
- **Accounts** — credential plus assigned role name — live in the auth store, outside dashboard data.

The service resolves account, then role, then permissions, on every call.

This satisfies both product-spec constraints that were pulling apart: Settings remains the interface for changing agent permissions, and credentials and tokens stay out of dashboard data.

The escalation guard followed: a write to dashboard configuration may not widen the role bundle held by the caller making it. D19 makes it moot — there is no write that reaches a role — and the guard was deleted from `service` rather than kept as dead enforcement.

### D4 — One enforcement point

Every request resolves to a role. There is no caller that skips the check, including the client, and including local callers. MCP has no special path.

Rejected: role checks on agent calls only, with client endpoints left human-trusted. That rebuilds the second door D1 removed — an agent that can reach the client's configuration endpoint would bypass its own permissions.

### D5 — Offline behaviour — superseded by D15

Recorded for history. D5 split offline behaviour along a structural line: cached reads, queued `data` writes, no offline `configuration` writes, with every write carrying the version it was based on. D13 replaced versioned writes with mutations, and D15 moved the line from structural to security. The surviving parts of D5 are:

- the client holds a cache so the dashboard stays viewable and interactive without a live service
- queued writes replay after reconnecting, and are enforced against the caller's role like any other write
- the user is told when they are working offline

### D6 — Module cut

Seven modules:

| Module           | Owns                                                                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract`       | Dashboard configuration shape and validation, mutation types, formatter compilation, card template schemas, role bundle shape. No React, no Node — imported by every other module. |
| `service`        | The one interface. Role resolution and enforcement, persistence, applying mutations.                                                                                               |
| `auth`           | Accounts, credentials, account-to-role resolution. Separate store from dashboard data.                                                                                             |
| `integrations`   | Optional, user-authorized external-service connections, and backup targets.                                                                                                        |
| `view`           | React application: rendering, Settings, offline cache, mutation queue, toast.                                                                                                      |
| `card-templates` | Card template components, paired with their schemas from `contract`. Split out on change cadence: these are added by source change, not through the service.                       |
| `mcp`            | Tool definitions. Calls `service`.                                                                                                                                                 |

`contract` is React-free by construction, since card template components live in `card-templates`.

### D7 — Single user is a fact, not a constraint

The application currently has one human user. The design must not foreclose more, but must not implement multi-user support now. Accounts are already plural and roles are already a bundle, so more users is more rows, not a reshape.

### D8 — A card is placement-free

A card carries nothing about where it sits or how big it is: no position, no size. It does not carry style either — see D10.

A card is therefore portable: the same card can appear on a different dashboard without dragging a placement it no longer fits. This is what makes D9 possible.

`CONTEXT.md`'s card definition ended "and the card's position and style". That clause was deleted, not moved.

A card carries its own state — see D18.

### D9 — The dashboard is a document

A dashboard is an ordered set of card references plus a theme reference. It is grid-capable later: today the ordering is flat, and cell and span can be added without reshaping anything, because no card claims a placement.

The `arrangement` array leaves the schema; the dashboard document replaces it. More than one dashboard over one pool of cards falls out for free.

No new vocabulary term: `CONTEXT.md` already defines a dashboard as "an arrangement or ordering of cards on a page or display".

### D10 — "Style" is deleted; theme is the term

The concept — a named set of semantic tokens (palette, fonts, spacing, density) whose swap changes every colour and font at once — is already in `CONTEXT.md` as **theme**. "Style" stops being a term anywhere in the project.

A dashboard carries a theme _reference_; theme definitions live beside it in dashboard configuration.

### D11 — "Wiring" is deleted

A formatter belongs to a query against an integration. An integration is the connection; it exposes queries. Formatter, query, and integration reference travel together as one unit, and every unit belongs to exactly one card — nothing is shared between cards, deduplicated, or registered centrally.

The `wiring` array leaves the schema.

### D12 — An unauthenticated local caller resolves to a named role

Requests arriving with no credential resolve to a role named in dashboard configuration, `local`, shipped with write on everything except `roles`, and narrowable in Settings.

This is not a bypass of D4 — the local caller is a role like any other, resolved at the one enforcement point.

Consequence: D5's phrase "live authenticated caller" was wrong. The offline restriction is about the service being reachable, never about a credential.

### D13 — Mutations, not versions

Every write is a mutation — a named change ("mark this task complete") applied against current state — rather than a snapshot of the state the caller last saw.

Consequences:

- no `revision` field on anything; the concept is not introduced
- a queued write that replays minutes late applies correctly without a staleness check, because it describes a change rather than a result
- `version` leaves the schema. It was a schema version, and with one machine, no stored data belonging to anyone else, and no migration (D17), it earns nothing. It returns the day someone else's data has to survive an upgrade.

Rejected: per-record revisions, and HTTP `ETag`/`If-Match`. Both detect a conflict that mutations mostly do not create.

### D14 — The service exposes `read` and `apply`

Two operations. `read(scope)` returns state; `apply(mutations)` applies one or more mutations atomically.

Mutation types are a tagged union in `contract`, each tagged with the permission category it requires — so enforcement is one lookup rather than a check hand-written per endpoint, and the offline queue is a list of `apply` payloads rather than its own serialization format.

MCP tools and client actions are both mutation constructors.

Rejected: a wide RPC surface (`addCard`, `moveCard`, `setTheme`, …). Every action would carry its own endpoint and its own permission check, and the queue would need a second format.

### D15 — Offline: the line is security, not structure

Mutations in the security categories — `roles` and `integrations` — require a live service. Every other mutation queues offline and replays on reconnect.

A permission grant or an external authorization applied blind, minutes later, against state the caller never saw, is the one case where "apply against whatever you find" is the wrong answer. Adding a card and rearranging a dashboard are not that case.

Supersedes D5's structural split.

### D16 — Integrations and backup targets share one module

Both are user-authorized connections to an external service. The authorization flow and credential handoff is most of the code and is identical; they differ only in direction — one supplies data, one receives a copy.

Split later if a second concern actually diverges.

### D17 — Rewrite three modules; keep the rest

`contract`, `service`, and `mcp` are written fresh from this document. The client's card rendering, the built-in formatter implementations, and the Google Calendar integration are kept.

Measured: 2,568 lines across `src/`, ~1,700 non-test. The three modules are ~900 non-test lines, and the configuration type flows into every remaining file regardless, so an incremental migration touches the same files while leaving both doors open in the meantime — `requireAccess` in `src/mcp/operations.ts` alongside the new enforcement point, with each individual diff looking reasonable in review.

No back-compat shim, no deprecation window, no migration of a configuration file that exists on one machine. Pre-alpha and non-functional — there is nothing to keep working.

Documents are updated in the same pass, not staggered behind the code.

### D18 — A card carries its state; `source` is deleted

A card has state, updated by mutations whatever produced them. There is no separate entity for data a card draws from, and no term for one: `source` names an origin, and origin is invisible to the card, the formatter, and the card template by construction. `CONTEXT.md`'s **source** entry is deleted.

A card is: an id, a title, a card template reference, its state, and zero or more queries. Each query names an integration, the query to run against it, and the formatter that reshapes the result into the card template's schema.

```ts
type Card = {
  id: string;
  title: string;
  template: string;
  state: unknown;
  queries: Array<{
    integration: string;
    query: unknown;
    formatter: FormatterSpec;
  }>;
};
```

Zero queries, one, or several — to the same integration or to different ones. There is no card type and no manual-versus-connected distinction: every card accepts manual edits to its state whatever its queries, and a card with no queries is not a special case, just an empty array.

Card state is stored already fitting the card template's schema, so rendering is a straight read with no transform. This makes structural the rule `CONTEXT.md` already states: a card template displays properly formatted data and nothing more. A formatter is deterministic — same input, same output, no IO, nothing read from outside its input.

Consequence: two cards showing the same calendar each hold their own query and their own copy. Accepted — cards stay self-contained per D8, no entity has two writers, and no merge rule is needed anywhere.

### D19 — Roles are changed at source, not through the service

Decided 2026-09-01, while implementing #60.

No mutation reaches a role. `edit-role` and `remove-role` are deleted, and no `add-role` was ever written. Roles join card templates, built-in formatters, and packages: things a source change alters and the service cannot touch at any permission level.

Consequences:

- The `roles` permission category survives, read-only in effect. It still gates `read("roles")` and decides whether `read("all")` returns the role list.
- D3's no-widening guard is gone. It existed to stop a role-editing write from granting itself more; with no such write, the guard was dead code.
- Settings no longer edits roles. It keeps integrations, themes, and font scaling.
- Changing a role means editing the persisted dashboard configuration or the source default, then restarting. Accepted for one human user (D7).

This narrows D3. Roles still live in dashboard configuration, still carry no credential, and are still resolved on every call — only the editing path is withdrawn.

**Stands. Sharpened by D35**, which moves roles into a source-imported roles file: still no mutation, still the same trust level as changing source, but a file meant to be edited rather than a literal in `contract`.

### D20 — Four permission levels: `noAccess`, `read`, `edit`, `write`

Decided 2026-09-01, while implementing #60.

`noAccess < read < edit < write`, ranked. The bottom level was named `none`
until it was renamed for explicitness: it read as an absence rather than as a
level, and sat one word away from the role a caller with no proof resolves to. `edit` changes something that already exists; `write` also creates and destroys. Each level implies every level below it.

The split falls on the mutation, not the category:

| Level   | Mutations                                                                                                            |
| ------- | -------------------------------------------------------------------------------------------------------------------- |
| `edit`  | `patch-card-state`, `edit-card`, `edit-dashboard`, `edit-theme`, `edit-integration`, `set-font-scale`, `insert-card` |
| `write` | `add-card`, `remove-card`, `add-theme`, `remove-theme`, `add-integration`, `remove-integration`                      |

The point is `data: edit` and `cards: edit`: a caller may change what a card shows without being able to add or delete cards. F1's categories gave blast radius by subject; this gives it by verb.

Enforcement stays one lookup (D14). The mutation carries its category tag; the required level is read off the mutation type, and both are compared against the caller's bundle by rank.

Consequence: `edit-*` mutations no longer create what they cannot find. Creation needs an explicit `add-*`, which needs `write`. `add-theme` and `add-integration` exist because Settings manages both. Dashboards have no creation mutation yet.

### D21 — One dashboard; it is not a multi-dashboard product

Decided 2026-09-01.

The application ships with one dashboard and offers no way to create or delete one. There is no mutation for either, and none is planned.

The dashboard arrives in the default configuration, and every entrypoint hangs off it — Settings is reached from the dashboard, so "no dashboard exists" is not a state the UI has to handle.

`dashboardConfigurationSchema` holds `dashboard`, one object, not an array. D9's shape is unchanged: a dashboard is a document holding ordered card references plus a theme reference, and a card sits in one pool. The dashboard keeps its `id`, and `insert-card` still names it.

Consequence: `edit-dashboard` is the only dashboard mutation. It reorders card references and changes the theme reference.

### D22 — The service assembles a card template's component from a declarative composition tree, narrowing D2

Decided 2026-09-03.

D2 put card templates on the source-change side of the line: reviewed like any code change, never reachable through the service. This narrows that: the service gains one specific capability, assembling a card template's component source from agent input, gated by a permission level like any other mutation. Card templates are no longer categorically unreachable through the service — this one path exists, and nothing else about D2 changes (roles, built-in formatters, and packages stay untouched by the service).

The input is a declarative composition tree — `{component: string, props: Record<string, unknown>, children: Node[]}` — describing which `react-aria-components` to nest and with what props. The agent never writes code; it sends this tree. The service assembles real source from it: real imports, real JSX, using the component names and props as given.

Correctness comes from the library itself, not a hand-authored parallel schema. An earlier draft of this decision specified per-component prop/children schemas (mirroring `formatterSpecSchema`) — that was wrong and already caught: it duplicates what `react-aria-components`' own TypeScript types assert, and a hand-maintained duplicate drifts from the real types. The assembled file is checked by `tsc --noEmit` (already in `npm run check`) against the library's real types — that is the entire props/children correctness check. The input schema itself stays small and library-agnostic by construction: it describes tree shape, not any one library's vocabulary.

Scope: **static trees only.** A tree of `{component, props, children}` cannot express local state or callbacks — it has no way to represent `useDragAndDrop`/`useListData`-style hooks, or a stepper's `useState`. A card template that needs those (drag-and-drop, the `SteppedListCard` pattern) stays hand-written source, outside this path, reviewed the ordinary way. Drag-and-drop is explicitly out of scope for the assembled path.

One mechanism, not two: whoever's editing a card template's source — hand-written or assembled — is real `react-aria-components` composition either way; a differently-run copy of this codebase is the same source code, not a second system with its own rules.

### D23 — A dashboard declares its component library and style vocabulary at initialization

Decided 2026-09-04.

A dashboard is built against one presentational library — shadcn/ui today — named once, when the dashboard is initialized, alongside the rest of the starting dashboard configuration (D9). This is a source/init-time declaration, not a mutation: nothing in the service surface changes which library a dashboard renders through, the same way nothing in the service surface changes a role (D19).

The declared library fixes what a theme (D10) can say. `add-theme`/`edit-theme` (`presentation`, D14/F1) pick values from the library's own vocabulary — its CSS variables, its utility classes — never arbitrary CSS. A theme's settings are a selection within the declared library, not a stylesheet.

Card templates (D22) draw their presentational classes from the same declared library. `react-aria-components` stays the structural layer D22 assembles from; the library governs how the assembled markup looks, not what it's built from.

Rationale: the same reasoning as D22's correctness argument, applied to styling instead of structure. Letting a mutation (or a card template) introduce CSS ad hoc would mean re-deriving what "in bounds" means per call. Naming one library once and constraining every later styling choice to its vocabulary keeps that vocabulary checkable and reviewable, the way `tsc --noEmit` checks D22's composition trees against `react-aria-components`' real types.

### D24 — A running dashboard serves its own card templates as a shadcn registry

Decided 2026-09-04.

Each dashboard's own server (`src/server`) serves its wired-in card templates (D22) as a shadcn-compatible registry (https://ui.shadcn.com/docs/registry/mcp): an index at `/r/registry.json`, each template's built payload at `/r/<name>.json`. Any shadcn-aware client — including one connected over `shadcn mcp` — can search, view, and add a template from a running dashboard the same way it would from shadcn's own registry.

The registry is per-dashboard, not per-repo: it's generated by the server process at request time from `includedCardTemplates` (`src/client/cards/index.ts`), the same map that decides which templates are real. A directory scan was rejected — the templates directory also holds a view component, an index module, tests, and in-flight `__assemble-*` files from a concurrent `assemble-card-template` call; scanning it would surface those as items. `includedCardTemplates` is the one place that already answers "which templates are real," so the registry reads that, not the filesystem.

Several templates share one source file (`display.tsx`). Because a registry item's file content is the whole file it names, `cardTemplateSourceFiles` (sibling export next to `includedCardTemplates`) maps each template to the file it actually lives in, so `table`, `list`, `calendar`, and `chart` all resolve correctly instead of a wrong `<name>.tsx` guess.

The index lists items without file content (metadata only: name, type, dependencies); each item's own `/r/<name>.json` inlines the real source as `content`. `dependencies` and `registryDependencies` are derived from the template's own imports (`react-aria-components`; `@/components/ui/<name>` for shadcn/ui primitives) rather than hand-maintained, so they can't drift from the source that actually ships.

Rationale: the registry only needed to answer "what can a client search, view, and add from this dashboard" — not also host arbitrary write/download. Discovery plus `add` closes the loop shadcn's own CLI expects; nothing further was built. Deriving everything (which templates exist, what file they're in, what they depend on) from data the codebase already maintains for other reasons is the same locality argument as D23: one source of truth, checkable, no second list to keep in sync by hand.

### D25 — shadcn/ui is the framework; the use of react-aria is stale, replacing D22 and D23's structural layer

Decided 2026-09-04.

shadcn/ui is the framework this project is built on. shadcn components are the default. Tailwind CSS is the default theming framework. shadcn/ui's own defaults are this project's defaults.

The use of `react-aria-components` in this project is stale. This is a decision about this project's direction, not a claim about the library: `react-aria-components` is actively maintained (v1.21.0 shipped 2026-09-01, no npm deprecation) and only individual props inside it carry `@deprecated`. What is stale is this codebase's reliance on it.

This replaces the structural layer named in D22 and D23. Both said `react-aria-components` is the structural layer a card template composes and the declared library governs how that composition looks. That two-layer split is gone: shadcn is the framework, and its components are what a card template composes.

What this settles by name:

- The component default is shadcn's components, not a headless layer wrapped in shadcn's classes.
- The theming default is Tailwind CSS. D23's rule stands — a theme selects from the declared library's vocabulary, never arbitrary CSS — with Tailwind and shadcn's tokens as that vocabulary.
- Unstated project defaults resolve to shadcn/ui's defaults rather than being decided case by case.

D23's shape is otherwise unchanged: one presentational library, declared once at initialization, fixing what a theme can say. This decision names which library that is and removes the second layer beneath it.

Open, pending further decisions in this session:

All three are settled: the assembler emits registry items and the old packages leave `package.json` (D32), and `themeSchema.settings` holds a typeset and the presentational half of `components.json` (D33).

### D26 — Base color is a per-user setting; every colour in the project is a semantic token

Decided 2026-09-04.

A user can change the base colour, and that one change recolours the whole project. Two halves make that work, and both are decided here.

**Every colour is a semantic token.** Every colour in a card or a component is a CSS semantic variable from the Tailwind/shadcn token set — `background`, `foreground`, `primary`, `muted-foreground`, `border`, `card`, and the rest. No hex literals, no palette-scale utilities (`bg-neutral-800`, `text-blue-500`), no per-card colour of its own. This is what makes one base-colour change propagate everywhere instead of reaching only the components that happened to be written against it; it is the colour counterpart of D23's rule that a theme selects from the declared library's vocabulary rather than writing CSS.

**Base colour is persistent and per-user.** The same card showing the same data renders in different base colours for different users. Base colour is therefore a property of who is looking, not of the card, the dashboard, or the data.

**Presets.** Colour presets can be added: a role holding `cards: write` adds presets available to everyone, and a user can add their own (D27).

Mechanism note, verified against the shadcn CLI: shadcn's own presets (`components.json`'s `tailwind.baseColor`, `shadcn apply --preset`) are a **build-time** operation — the CLI rewrites config, CSS variables, and component files on disk. That is not a per-user runtime switch and cannot be one. A per-user base colour is served by scoping the token values themselves — the `oklch(...)` definitions currently sitting in `:root`/`.dark` in `src/styles.css` — to the current user at runtime. The semantic-token rule above is what makes that scoping sufficient. `components.json` remains the project's build-time default, not the per-user mechanism.

The four questions D26 left open are settled in D27.

### D27 — Per-user configuration lives in the user's own env files; base colour modifies a theme

Decided 2026-09-04. Settles the four questions D26 left open.

**Where per-user configuration lives.** Each user has their own `.env` file or files. Per-user configuration is read from there rather than from dashboard configuration, which stays shared.

This keeps D3's split intact and extends it: dashboard configuration holds what everyone sees, and a user's env files hold what is theirs. It also keeps credentials out of dashboard data, which the product spec already required and D3 already enforced for accounts.

Amended by D28: a user's env files hold their **preferences** — base colour and font scale. Auth tokens do not live there. The original wording of this decision put third-party auth tokens in the same env files; that was replaced, because a plaintext file is the homebrew credential storage D28 rejects.

**`fontScale` is per-user.** It moves out of dashboard configuration onto the same per-user axis as base colour. `set-font-scale` (`presentation`, `edit`) is a mutation against shared configuration today; that no longer matches where the value lives.

**Base colour modifies a theme.** Base colour is not a peer of a theme and not an independent layer over one — it is a modifier of the theme. It controls the default token values generated for the project at `init` or when a preset is applied.

**Preset format.** A preset follows the format in `globals-example.css`: the `@theme inline` block mapping `--color-*` to the bare token names, then `:root` and `.dark` blocks defining every token as an `oklch(...)` value, then the `@layer base` rules. A preset is a whole token set in that shape, not a partial override.

**Who adds presets.** `admin` adds presets available to everyone (D35). A user may also add their own; their own presets are user-owned and not governed by the permission matrix.

**Generation is build-time only.** Nothing generates token values at runtime. A custom theme defines every semantic-variable-to-colour pair explicitly, in the `globals-example.css` format, so there is nothing left to generate from it. Base colour's generating role applies at `init` and preset-apply; from then on a theme is a complete, literal token set.

Per-user base colour is therefore selection among complete token sets, not per-user generation. What a user's configuration holds is which set applies to them.

### D28 — Credentials are stored by best practice, not by hand; preferences and secrets split

Decided 2026-09-04.

Credential storage uses an established approach for each of the two problems here. Neither is hand-rolled, and neither is a plaintext file.

**Account credentials — hashed, never stored.** This dashboard's own auth (`src/auth/index.ts`) only ever needs to _verify_ a credential, so the credential is not stored at all: a hash is. Node's built-in `crypto.scrypt` derives it and `crypto.timingSafeEqual` compares it, so no dependency is added. The existing `ponytail:` comment at `src/auth/index.ts:45` already names this as the upgrade path from the current plaintext, non-constant-time compare.

**Integration tokens — encrypted at rest.** A third-party auth token must be recoverable to be sent in an `Authorization` header, so hashing is not available. Tokens are encrypted at rest with AES-256-GCM under a key held outside the data directory, decrypted in memory at request time and never written back in the clear.

`CredentialStore` (`src/server/integrations/credentials.ts`) is already the single seam every path goes through to reach a stored secret, with one implementation behind it. This decision replaces that implementation; nothing above the interface changes.

**Preferences and secrets are stored differently.** A user's env files hold preferences — base colour, font scale. Secrets never go there. This amends D27, which had put auth tokens in the same env files.

The encryption-at-rest choice follows from D29: users share one dashboard and one set of card data, so there is a shared server process rather than a dashboard per machine. An OS secret store (Keychain, DPAPI, libsecret) would be the better answer for a dashboard running locally per user, and this decision should be revisited if that topology ever becomes the real one.

Secrets live on the server host, in the same place as the server (D30) — never with a client.

**Key rotation: every 90 days.** The encryption key is rotated on a 90-day policy. Rotation re-encrypts every stored token under the new key; a stored token carries the identifier of the key it was sealed under, so a token written before a rotation is still readable while the re-encryption pass runs. Old keys are destroyed once no stored token references them.

90 days is a starting figure, chosen to be a policy rather than an absence of one. It is not derived from a threat model and can be shortened without anything else changing.

### D29 — An integration is a shared interface; each user supplies their own token and queries, and results are shared

Decided 2026-09-04.

Several users share one dashboard. Each contributes data to it, from their own third-party integrations and from manual or agentic input, and what any user contributes is visible to every user.

**An integration is a shared interface with per-user authorization.** The integration — its type, its query surface, its adapter — is shared and defined once. What is per-user is the authorization: each user supplies their own auth token for it. Two users connected to the same kind of service are using one integration interface with two tokens, not two integrations.

**Queries are user-specific.** A user supplies one or more queries to run against their own authorized connection. A query therefore carries whose token it runs under, which it did not before.

**Results are shared.** A query's result, once formatted and stored as card state, is visible to every user of the dashboard. Data enters through one user's authorization and becomes common to all of them. This is intended, and it is the reason the dashboard has more than one contributor.

This is a deliberate privacy posture, recorded so it is not mistaken for an oversight: a user who authorizes an integration is contributing its data to a shared surface, not viewing it privately. Anything a user does not want every other user to see must not be brought in through a query.

**Consequences for decisions already taken.** D7 said one human user was a fact and not a constraint — that fact no longer holds, and the plural accounts and role bundles it anticipated are now load-bearing rather than latent. D21's single dashboard is unaffected: one dashboard, several contributors.

The four questions this decision opened are settled in D30.

### D30 — A card owns its queries keyed by user; last write wins

Decided 2026-09-04. Settles the four questions D29 opened.

**A card owns its queries, keyed by user.** A card's `queries` becomes a map from user to that user's queries — `{user: [queries], ...}` — replacing today's flat `queries: z.array(querySchema)` (`src/contract/index.ts:143`). Queries stay on the card rather than moving onto the user, so a card remains the thing that knows what feeds it, and D18's "a card carries its state" is unchanged.

Queries therefore live in dashboard configuration, which is shared. A query is not a secret; only the token it runs under is (D28).

**Replaced by D32.** Queries do not live on the card. They are stored with user data, and a card does not carry them at all. The rest of this decision stands.

**Last write wins.** When two users' queries write the same card's state, the most recent write is the state. No merge, no designated contributor, no version check — consistent with D13, which took versions and staleness checks out of the model entirely.

This is a deliberate simplification with a known ceiling, not a claim that conflicts do not matter: two contributors to one card can overwrite each other and neither is told. Future rules may replace it. The implementation should carry a `ponytail:` comment naming the ceiling so the shortcut is tracked rather than forgotten.

**Adapters receive user secrets at update time.** An integration adapter is passed the relevant user's secret when an update fires. The existing `tokenProvider` seam (`src/server/integrations/index.ts`) already carries a token to an adapter per call; it gains the user dimension rather than being replaced.

**Supplying a query needs the same permission as manually adding data.** That is `patch-card-state` — `data`, `edit` (`src/contract/index.ts:335`). Supplying a query is contributing data, so it is governed as contributing data, not as editing a card. This resolves the straddle D29 named: it lands in `data`, not `cards` or `integrations`.

**Amended by D35.** A user's own queries are not governed by the permission matrix at all. They belong to that user by structure (D32), so no category or level gates them — the matrix governs shared and server-owned things only. The one role-gated action against another user's queries is deletion, held by `admin`.

**Secrets are stored on the server host,** in the same place as the server, not with any client.

**A user may only supply queries under their own key.** A caller writing a card's `queries` map may write their own key and no other. Because a query runs under the token of the user it is keyed to, writing another user's key would cause fetches under that user's authorization — a privilege escalation across users. Enforced at the one enforcement point (D4), like every other check.

Query visibility is settled in D31; key rotation in D28.

### D31 — A user's queries are visible only to that user

Decided 2026-09-04.

A query is visible to the user who supplied it and to nobody else. Query _results_ remain shared — that is D29 and does not change. What is private is the query itself: which integration a user draws from, and what they ask it for.

The reason is that a query is revealing in a way its result is not. A shared calendar card says what is on the calendar; the query behind it says whose calendar, filtered how, searched for what. D29 made results common deliberately. It did not intend to make every user's search terms common as a side effect.

**Mechanism: superseded by D32.** This decision originally kept queries on the card and had `read` narrow each card's `queries` map to the caller's own key. D32 moves queries out of the card and into user data, where the storage boundary does the same work directly — a caller reading their own user data reads their own queries and there is nothing of anyone else's to filter out. The outcome this decision names is unchanged; only the mechanism is.

Refresh runs server-side under each query's owner's token (D30), so what a caller can read does not stop another user's queries from running.

### D32 — Queries are stored with user data; the assembler emits registry items; the old packages go

Decided 2026-09-04.

**Queries move to user data.** A query is stored with the user who supplied it, not on the card. This replaces D30's user-keyed map on the card: a card no longer carries queries at all. Only the owning user holds access permissions on their queries.

The one exception is deletion: `admin` may delete a user's queries (D35). Nothing else reaches them — not read, not edit.

This makes D31's privacy outcome structural rather than enforced by filtering. There is no shared object holding another user's queries, so there is nothing to redact on read.

**The card-template assembler emits registry items.** `assemble-card-template` (D22) produces a registry item conforming to the shadcn registry item schema — `name`, `type`, `files`, `dependencies`, `registryDependencies`, and the optional install-time fields — rather than a bare `.tsx` file. This closes the gap between D22 and D24: the assembler's output and the registry's served items become the same artifact in the same shape, instead of the registry wrapping raw source after the fact.

**`react-aria-components` leaves `package.json`.** D25 made its use stale; this removes it. Pre-alpha, so it is deleted outright rather than deprecated.

Corrected: this decision first said `@base-ui/react` goes with it. That was wrong, and so was the first correction's reason for keeping it.

`@base-ui/react` is not shadcn's substrate — shadcn is not tied to Base UI at all. `components.json` carries a `base` field of `radix` or `base` that "determines component APIs and available props", and the `shadcn` package itself depends on neither: the primitive library arrives with the components the CLI writes. The two APIs differ enough to need their own ruleset (`asChild` versus `render`, Select's `items`, Slider scalar versus array).

It stays because this dashboard chose the `base-nova` preset. Having chosen `base`, `src/components/ui/{badge,button,separator}.tsx` import it directly and removing it breaks them; `card.tsx` and `table.tsx` need no primitive at all. Moving to Radix would be a preset change, not a package edit.

shadcn is strictly React, though: every template it offers is a React one — `next`, `vite`, `start`, `react-router`, `astro` — and the Vue and Svelte ports are separate projects.

`react-aria-components` has not left yet either: the composition-tree assembler (D22) still generates imports from it and typechecks against it, so it goes once that is reworked onto the registry-item output above.

**Theme schema is defined by Tailwind CSS and shadcn/ui.** The shape of a theme is not this project's invention — it is the token vocabulary those two define. What `themeSchema.settings` holds concretely is still open, pending a further decision.

**The original five card templates are deleted.** `message`, `table`, `list`, `calendar`, and `chart` (`src/client/cards/`) go. They render raw HTML with no styling, predate every decision from D25 onward, and are not a base to build on.

Done, with what fell out of it recorded here because a dashboard that renders nothing is a surprising state to find the tree in:

- `cardTemplateSchemas` is empty, and a card template name is now validated by membership in it rather than by a fixed enum — `z.enum` needs at least one member.
- `defaultDashboardConfiguration` ships no cards and an empty dashboard, since no template exists for one to name. `CardView` renders "this dashboard has no card template" for any card that does name one.
- The registry serves an empty index. That is correct rather than broken: it reports what this dashboard actually has.
- `formatMessage`, the built-in formatter for the `message` template, goes with it. `formatIdentity` stays.
- The deleted schemas moved to `src/test-support/card-template.ts`, out of the shipped product. Tests about the service, the contract, and the registry are not about which templates ship — they need only that one exists — so they register a fixture rather than being deleted alongside it.

Which role holds the delete permission is settled in D35: `admin`. The `local` role this decision named no longer exists — D35 replaced it with the local user, proved by token, and shipped `admin` and `user` as the two roles.

What `themeSchema.settings` holds is settled in D33.

### D33 — A theme's settings are a typeset and the presentational half of `components.json`

Decided 2026-09-04. Settles what D25 and D32 left open.

**The dividing line: a user owns appearance via semantics; the server owns data and card templates.** A user says what things should look like in the vocabulary the library already defines. They never say it in CSS, and they never reach a card template's markup or a card's data. This is accepted as significantly restructuring the code.

**A theme's settings are two things.**

_A typeset_ (https://ui.shadcn.com/docs/typeset) — shadcn's typography system, "one CSS file you own", carrying:

| Variable                 | Holds                 |
| ------------------------ | --------------------- |
| `--typeset-size`         | base text size        |
| `--typeset-leading`      | line height           |
| `--typeset-flow`         | space between blocks  |
| `--typeset-font-body`    | body font family      |
| `--typeset-font-heading` | heading font family   |
| `--typeset-font-mono`    | monospace font family |

A typeset inherits the theme's colour, font, and radius tokens rather than restating them, so it composes with the base colour and preset decided in D26 and D27 instead of competing with them.

_The presentational fields of `components.json`_ — `style`, `tailwind.baseColor`, `tailwind.cssVariables`, `iconLibrary`, `rtl`, `menuColor`, `menuAccent`.

**Only the presentational half.** `components.json` also carries fields that are code structure, not appearance: `aliases`, `rsc`, `tsx`, `tailwind.config`, `tailwind.css`, `tailwind.prefix`, `registries`, `$schema`. Those are server-owned and unreachable through a theme — a user changing `aliases` would be rewriting import paths, not choosing a look. The split follows the same line as the decision above: semantics to the user, structure to the server.

**`fontScale` is replaced.** `--typeset-size` is the same setting with a better vocabulary alongside it, so `fontScale`, its `set-font-scale` mutation, its MCP tool, and its Settings control all go rather than sitting beside a typeset that also sets text size. D27 made `fontScale` per-user; a typeset is per-user for the same reason and subsumes it. Pre-alpha, so it is deleted outright.

Consequence: font scale stops being a single number in dashboard configuration and becomes part of the user's typeset, read from their own configuration (D27).

### D34 — `components.json` is per-user, generated by extending a server-owned template

Decided 2026-09-04.

There is one `components.json` in the repository today, shared by everything. It becomes per-user: each user has their own, produced by extending a server-owned base template rather than written from scratch or edited in place.

The server template carries the structural fields — `aliases`, `rsc`, `tsx`, `tailwind.config`, `tailwind.css`, `tailwind.prefix`, `registries`, `$schema`. A user's extension carries the presentational ones — `style`, `tailwind.baseColor`, `tailwind.cssVariables`, `iconLibrary`, `rtl`, `menuColor`, `menuAccent`. That is D33's split, expressed as a file layout instead of a rule: a user cannot reach a structural field because their file does not contain one.

**Why extension rather than mutation.** shadcn's own documentation (https://ui.shadcn.com/docs/components-json) states that `style`, `tailwind.baseColor`, and `tailwind.cssVariables` cannot be changed after initialization. Those are exactly the fields a user owns. A per-user `components.json` therefore cannot be a document edited over time — it has to be generated at that user's initialization, from the server template plus that user's choices, and regenerated rather than patched when they change. This is the same rule D26 already set for colour: generation happens at build time, and what exists at runtime is a complete, literal artifact.

Doc-version caution: the page above lists `style` as accepting only `new-york` and omits `iconLibrary`, `menuColor`, `menuAccent`, and `rtl`, while this repository's `components.json` already uses `base-nova` and carries all four. The page lags the CLI. Treat the shipped `components.json` and `shadcn --help` as the truth for which fields exist, and the doc for what each one means.

Reference: https://ui.shadcn.com/llms.txt indexes shadcn's documentation and is the entry point for looking any of this up. Recorded in `AGENTS.md`.

### D35 — Two roles, `admin` and `user`; user-owned things leave the permission matrix

Decided 2026-09-04.

**The matrix governs shared and server-owned things only.** Anything that belongs to one user — their queries, their base colour, their typeset, their own presets — is theirs by structure and is not gated by a category or a level. A user does not need a permission to change their own appearance or supply their own query, because nothing else can reach those in the first place (D32, D33). This removes from the matrix the per-user permissions earlier decisions had put there.

**Two roles ship as defaults.** They are ordinary configuration, not fixed names in the source — see below.

| Category       | `admin` | `user`     |
| -------------- | ------- | ---------- |
| `data`         | `write` | `write`    |
| `cards`        | `write` | `read`     |
| `presentation` | `write` | `read`     |
| `integrations` | `write` | `read`     |
| `roles`        | `read`  | `noAccess` |

`user` holds every `data` permission and reads cards, presentation, and integrations. It has no `cards: edit` and no `cards: write`: a user contributes data to cards but does not retitle, re-template, add, or remove them.

`admin` is additionally the role that may delete another user's queries (D32) and that adds colour presets for everyone (D26).

**Roles are configurable by editing a roles file the source imports.** The two above are defaults, not hard-coded names. A deployment adds, changes, and removes roles by editing that file — not through the service.

This does not reverse D19; it sharpens it. Editing the roles file requires the same access as editing source code, so it sits at the same trust level. No `add-role`, `edit-role`, or `remove-role` mutation exists, `roles: edit` and `roles: write` stay dead cells, and D3's no-widening guard stays deleted — there is still no service write that could widen a caller's own bundle.

**Consequence: roles leave dashboard configuration.** This narrows D3, which put them there. `roles` was a key inside the persisted configuration, and `persistence.write` serializes that whole object on every applied batch — so roles were data in a file the service rewrites, not a file the source imports, and the trust level above was not real. What survives from D3 is that a role carries no credential and is resolved on every call.

Done: roles live at `src/contract/roles.ts`, out of `dashboardConfigurationSchema` and out of `dashboard.json`. `service` takes them as a dependency defaulting to that import, so only a test overrides them. `read("roles")` and `read("all")` serve the roles file; nothing writes it.

**Why `integrations` reads `read` for `user`, not "write, user-scoped".**

The word "integrations" covers two different things, and they belong on opposite sides of the user/server line:

| Thing                                                             | Example                                         | Owner  |
| ----------------------------------------------------------------- | ----------------------------------------------- | ------ |
| The **integration** — the service, its adapter, its query surface | "this dashboard can talk to a calendar service" | server |
| A **user's authorization** to it — their token and connection     | "my account is connected, under my token"       | user   |

A permission bundle has five categories and one level each. It has no way to say _whose_. So "full integrations, scoped to their own" cannot be written as a bundle — but it does not need to be, because the two halves are governed differently:

- The **integration** is shared. `user` gets `read`: they can see which integrations exist and connect to one, but cannot add, remove, or redefine one. `admin` gets `write`.
- A **user's own authorization** is theirs by structure, exactly like their queries. No level gates it, because nothing else can reach it. Connecting and disconnecting their own account needs no permission.

This is the same resolution as queries, applied to connections, and it keeps the matrix five-by-four.

**`user` has all `data` permissions.** `data: write` grants read, edit, and write together, since the levels are ranked (D20).

**The local caller is the local user, and gets everything.** The local user — the OS account running the server — `$USER` or `root` — resolves to full permissions, equal to `admin`. Everyone else resolves to no permissions at all until they authenticate.

This replaces D12's `local` role. The reasoning is the same as the roles file above: the OS user running the process can edit the roles file, the dashboard data, and the source, so withholding permissions from them through the application would be theatre. Nothing is defended by it. A caller who is not that user is defended against, and starts from nothing.

**How the local user is proved.** Loopback is not proof: the server binds `127.0.0.1`, which shows the caller is on the same machine, not that it is the same OS account. The proof is a random token written at startup to `.dashboard/local-user-token` with mode 0600 — reading that file is the check, and the filesystem enforces it.

Each door proves it differently, for the same reason:

| Door                 | How the caller is the local user                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `mcp`, over stdio    | By construction. Spawning the process already required being that OS account, and there is no port to reach it on.          |
| the browser, on HTTP | The server prints `http://127.0.0.1:<port>/?token=…` to its own stdout. Only whoever can read that stdout is the same user. |

The page stores the token in `sessionStorage` and strips it from the address bar, then sends it as a bearer credential. Another OS account can still open the port and load the page, but never receives the token, so it proves nothing and resolves to `unauthenticatedUser` — not to the local user, as loopback alone would have given it. This is how Jupyter authenticates a local notebook.

A build with no token provisioned treats an unproven caller as the local user, since there is then no door at which anything could be proved. `service` decides this from whether `localUserToken` is set.

**Each platform restricts the file its own way.** POSIX gets `chmod` 0600. Windows cannot: `chmod` there maps onto the read-only flag, so a token written with mode 0600 lands readable by everyone. Measured on this repository, a plain file under `.dashboard/` carries inherited entries for `BUILTIN\Users` and `NT AUTHORITY\Authenticated Users` — every account on the host. Windows therefore gets `icacls <path> /inheritance:r /grant:r <user>:F`, which drops the inherited entries and leaves one name on the file. Verified: the provisioned token reads `BANANATOP\mattm:(F)` and nothing else.

Security on Windows was possible after all, so it is done rather than conceded. If the `icacls` call fails, the failure is written to stderr and startup continues: the dashboard runs and the token still authenticates, and only the file's protection is lost.

`ls` under a POSIX emulation on Windows still prints `-rw-r--r--` for the hardened file. It is reading a translation, not the ACL; `icacls` is what says what is true.

### D36 — A card template is a registry item; agents compose primitives, never raw HTML or CSS

Decided 2026-09-05.

**The vocabulary is shadcn's.** A card template is a registry item — the same
unit shadcn distributes, serves, and installs. `registry item` enters
`CONTEXT.md`; nothing about it is this project's invention, and its fields are
whatever <https://ui.shadcn.com/schema/registry-item.json> says they are.

**An item carries more than one component.** A composition can arrive with the
hook, utility module, tokens, and stylesheet rules it needs — `registry:hook`,
`registry:lib`, `cssVars`, `css` — in the same item, rather than as loose
instructions beside it. This does not widen D22's assembled path, which still
cannot express a hook: an item carrying one is hand-written.

**Composition is what an agent submits.** Raw HTML elements and hand-written CSS
are not an accepted substitute for composing the declared library's primitives.
This is a rule about what is authored, not about what is rendered — the browser
receives HTML whichever way the source was written, so "it renders HTML anyway"
does not license submitting HTML.

`ARCHITECTURE.md` said native HTML and CSS were used "where they are sufficient",
which read as permission to skip composition. That line is replaced.

### D37 — Adding a card template takes `cards: write`, which `admin` holds

Decided 2026-09-05.

Adding a card template is `admin`'s to do. The permission is `cards: write`
(D35) — already what `assemble-card-template` requires (D20, D32), and now what
governs a hand-written one too.

`ARCHITECTURE.md` called hand-writing one "an ordinary source change, reviewed
like any other", which framed the two paths as differently governed: one by a
permission, one by repository access. They are not. Hand-writing a card template
is the same authority exercised at source, and code review is what checks the
work, not what grants the right to do it.

This narrows D2 further. D2 put card templates wholly on the source-change side;
D22 carved out the assembled path; this names the permission that covers both.
Built-in formatters and packages are untouched — those stay source-only, reachable
by no role.

Consequence for `user`, which holds `cards: read` (D35): a user cannot add a card
template by either path.

### D38 — `formatter` becomes `cardMapper`, and mappers live in a shared store

Decided 2026-09-05.

**The term.** What was called a formatter is a **card mapper** — Fowler's mapper:
an object setting up a correspondence between two schemas that stay independent
of each other. `formatter` named the wrong thing; the artifact does not format
anything, it restates a shape.

Named for what it maps _to_. What it maps _from_ is any structured data source,
not only an API response, so naming it after the source would be too narrow.

`formatter` is not recycled. It stays free for business logic that changes data
before it reaches a card — a different thing, not defined here, and not to be
conflated with a mapping.

**The home: one shared store, referenced by name.** A card mapper lives in a
store that cards import from; a card names one rather than carrying a copy. Two
queries needing the same mapping name the same mapper instead of each holding a
duplicate.

**This narrows D11.** D11 deleted "wiring" partly on the grounds that nothing is
shared between queries, deduplicated, or registered centrally — a mapper store is
exactly a central registry. What survives of D11: a query still names its own
integration and still runs on its own, and two queries against one calendar still
fetch separately and hold their own results. What changes: the mapping between
them is shared rather than copied.

**Who writes one.** A user does — writing a card mapper is theirs by structure,
like supplying a query (D35), because a mapper is a declarative spec rather than
code and a user could not otherwise make their own query render. Changing or
deleting a mapper another card already references is a change to a shared object,
and takes `cards: write`.

Adding under a name already in the store fails rather than overwriting.

**Unchanged.** A card mapper is still deterministic, still runs on the way in,
still `"identity"` or a bundled function or a declarative spec, and built-in
mappers are still source-only.

---

## Frontier

The questions this session opened, and where each landed. All settled.

### F1 — Permission categories — SETTLED

Five categories. `data` and `cards` are the shipped keys, unchanged; `configuration` is split three ways, because granting a role is a security change and adding an integration is not.

| Category       | Owns                                                         |
| -------------- | ------------------------------------------------------------ |
| `data`         | Card state                                                   |
| `cards`        | Cards, including their queries and the formatter inside each |
| `presentation` | Dashboards, themes, font scaling                             |
| `integrations` | Integrations                                                 |
| `roles`        | Roles                                                        |

Values are uniform across every category — see D20 for the levels. `roles` is not special-cased in the type; D19 makes it read-only in effect, because no mutation reaches a role.

`data: edit` ticks a task. `cards: write` adds, removes, retitles, or re-templates a card. Different blast radius, different key.

Every writable thing in dashboard configuration maps to exactly one key.

### F2 — What the unauthenticated local caller may do — SETTLED

See D12.

### F3 — Mutation list — SETTLED as a way of working

There is no upfront list. Mutation types are defined in `contract` as each one is needed, tagged with the permission category it requires so `service` enforces with one lookup (D14).

Decisions to make while writing them:

- which mutations `mcp` exposes as tools, decided as the tools are written

### F4 — Version and staleness contract — SETTLED

See D13. No version, no staleness contract.

### F5 — Integration boundary — SETTLED

See D16.

### F6 — Card and card template shape — SETTLED

Settled by D8, D10, D11, and D18. A card is an id, a title, a card template reference, its state, and zero or more queries.

### F7 — Documentation targets — SETTLED, DONE

See D17. Both documents change in one pass with the rewrite.

**Done — both documents were updated in `cd8e98e` (#65). The list below is the
work that was carried out, kept as a record of what changed and why. It is not
outstanding.**

`ARCHITECTURE.md`

- line 7 — the MCP module is named as the interface an agent changes the dashboard through; the service is the interface and MCP is one peer over it (D1)
- lines 22–25 — the module map lists four modules; the cut is seven (D6)
- lines 40–47 — the rendering path has a card naming a source and a formatter mapping at render; state is stored pre-formatted and a formatter runs on the way in (D18)
- line 51 — "mutates cards, wiring, and arrangement"; `wiring` and `arrangement` are both deleted (D9, D11)
- line 53 — three permission categories; there are five (F1)

`CONTEXT.md`

- **card** carries "position and style"; it carries state and queries instead (D8, D18)
- **source** and **wiring** are deleted as terms (D11, D18)
- **style** overlaps **theme**; theme is the term (D10)
- **formatter** describes a render-time mapping; a formatter belongs to one of a card's queries, is deterministic, and runs on the way in (D11, D18)
- **dashboard** needs the document shape: ordered card references plus a theme reference (D9)
- `role`, `account`, `mutation`, and `query` need entries (D2, D13, D18)

### F8 — Where a card's data lives — SETTLED

See D18.

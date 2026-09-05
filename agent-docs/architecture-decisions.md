# Architecture decisions

The decisions in force, and why each was made. **When planning, this document is
the authoritative source of truth** — where it conflicts with anything else, it
wins.

It is deliberately ahead of the code. The code describes what exists; this
describes what was decided, and a disagreement between them is not a bug to fix
here. [`implementation-spec.md`](implementation-spec.md) lists the decided work
the tree has not caught up with.

Superseded reasoning is deleted rather than annotated: the git history holds what
was thought before, so a reader arriving today reads only what is true today.
Numbers are stable and never reused, so a gap in the sequence means a decision
was withdrawn, and a reference from an issue or a commit still resolves.

The application is pre-alpha and non-functional: nothing is released, no stored
data belongs to anyone, and nothing depends on current behaviour. No decision
here is constrained by back-compat, migration, deprecation windows, or a name
clash with what exists. Where a decision replaces something, the old thing is
deleted outright. Documents are updated in the same pass as the code, never
staggered behind it.

Vocabulary this document settled: `role`, `account`, `mutation`, `query`,
`registry item`, and `card mapper` are terms; `source`, `wiring`, and `style` are
not. `formatter` is reserved for business logic that changes data before it
reaches a card, and is not a synonym for a card mapper. Every term is defined in
[`CONTEXT.md`](../CONTEXT.md).

---

## Decisions

### D1 — One service interface; client and MCP are peers over it

The service exposes one interface. The client and the MCP server are two consumers of that same interface, with no privileged path between them.

Rejected: MCP reaching persistence through a shared library, or MCP owning its own copy of persistence and path-containment logic. Both produce more than one door to the same file, and a permission or authentication check on one door does not cover the other.

Consequence: the MCP server cannot run without the service process.

### D2 — Role is a named bundle of permissions

`role` carries its ordinary meaning in authentication: a named set of permissions, bundled together and assigned to an account. `account` is the identity a caller presents. How accounts are created, and how a role is assigned to one, is not decided.

There is no separate "developer" and "user" concept in the architecture. What distinguishes those two kinds of work is which door the change goes through:

- changes to dashboard configuration go through the service, governed by a role
- built-in card mappers and packages are source changes, unreachable through the service at any permission level
- card templates sit in between: the service can assemble one (D22), and either path takes `cards: write` (D37)

### D3 — Accounts live in the auth store

An account — a credential plus the name of the role assigned to it — lives in the auth store, outside dashboard data. A role carries no credential.

The service resolves account, then role, then permissions, on every call.

This is what keeps credentials and tokens out of dashboard data, which the product spec requires.

### D4 — One enforcement point

Every request resolves to a role. There is no caller that skips the check, including the client, and including local callers. MCP has no special path.

Rejected: role checks on agent calls only, with client endpoints left human-trusted. That rebuilds the second door D1 removed — an agent that can reach the client's configuration endpoint would bypass its own permissions.

### D6 — Module cut

Seven modules:

| Module           | Owns                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contract`       | Dashboard configuration shape and validation, mutation types, card mapper compilation, card template schemas, role bundle shape. No React, no Node — imported by every other module. |
| `service`        | The one interface. Role resolution and enforcement, persistence, applying mutations.                                                                                                 |
| `auth`           | Accounts, credentials, account-to-role resolution. Separate store from dashboard data.                                                                                               |
| `integrations`   | Optional, user-authorized external-service connections, and backup targets.                                                                                                          |
| `view`           | React application: rendering, Settings, offline cache, mutation queue, toast.                                                                                                        |
| `card-templates` | Card template components, paired with their schemas from `contract`. Split out on change cadence: they change when a template is added, not when the service surface moves.          |
| `mcp`            | Tool definitions. Calls `service`.                                                                                                                                                   |

`contract` is React-free by construction, since card template components live in `card-templates`.

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

### D11 — A query travels with its integration reference; "wiring" is not a term

An integration is the connection, and it exposes queries. A query names the integration it runs against, so the two travel together and no third entity binds them.

Two queries against the same calendar run separately and hold their own copy of the result. Nothing about a query is deduplicated or pooled. The card mapper a query names is the one shared part (D38).

### D13 — Mutations, not versions

Every write is a mutation — a named change ("mark this task complete") applied against current state — rather than a snapshot of the state the caller last saw.

Consequences:

- no `revision` field on anything; the concept is not introduced
- a queued write that replays minutes late applies correctly without a staleness check, because it describes a change rather than a result
- there is no schema `version`. With no stored data belonging to anyone else and no migration, it earns nothing. It returns the day someone else's data has to survive an upgrade.

Rejected: per-record revisions, and HTTP `ETag`/`If-Match`. Both detect a conflict that mutations mostly do not create.

### D14 — The service exposes `read` and `apply`

Two operations. `read(scope)` returns state; `apply(mutations)` applies one or more mutations atomically.

Mutation types are a tagged union in `contract`, each tagged with the permission category it requires — so enforcement is one lookup rather than a check hand-written per endpoint, and the offline queue is a list of `apply` payloads rather than its own serialization format.

MCP tools and client actions are both mutation constructors.

Rejected: a wide RPC surface (`addCard`, `moveCard`, `setTheme`, …). Every action would carry its own endpoint and its own permission check, and the queue would need a second format.

### D15 — Offline: the line is security, not structure

Mutations in the security categories — `roles` and `integrations` — require a live service. Every other mutation queues offline and replays on reconnect.

A permission grant or an external authorization applied blind, minutes later, against state the caller never saw, is the one case where "apply against whatever you find" is the wrong answer. Adding a card and rearranging a dashboard are not that case.

The rest of offline behaviour:

- the client holds a cache, so the dashboard stays viewable and interactive without a live service
- queued writes replay after reconnecting, and are enforced against the caller's role like any other write
- the user is told when they are working offline

### D16 — Integrations and backup targets share one module

Both are user-authorized connections to an external service. The authorization flow and credential handoff is most of the code and is identical; they differ only in direction — one supplies data, one receives a copy.

Split later if a second concern actually diverges.

### D18 — A card carries its state

A card has state, updated by mutations whatever produced them. There is no separate entity for the data a card draws from, and no term for one: origin is invisible to the card, the card mapper, and the card template by construction.

A card is an id, a title, a card template reference, and its state:

```ts
type Card = {
  id: string;
  title: string;
  template: string;
  state: unknown;
};
```

There is no card type and no manual-versus-connected distinction: every card accepts manual edits to its state whether or not a query also writes it.

Card state is stored already fitting the card template's schema, so rendering is a straight read with no transform. A card template displays data that already fits its schema and nothing more.

### D19 — Roles are changed at source, not through the service

Decided 2026-09-01.

No mutation reaches a role. There is no `add-role`, `edit-role`, or `remove-role`. Roles join built-in card mappers and packages: things a source change alters and the service cannot touch at any permission level.

Consequences:

- The `roles` permission category survives, read-only in effect. It still gates `read("roles")` and decides whether `read("all")` returns the role list.
- There is no no-widening guard, because there is no write that could widen a caller's own bundle.
- Settings does not edit roles. It keeps integrations, themes, and a user's own appearance.
- Changing a role means editing the roles file and restarting (D35).

### D20 — Permission categories and levels

Decided 2026-09-01.

Five categories, each holding one level:

| Category       | Owns                                    |
| -------------- | --------------------------------------- |
| `data`         | Card state                              |
| `cards`        | Cards, card templates, and card mappers |
| `presentation` | The dashboard, themes, presets          |
| `integrations` | Integrations                            |
| `roles`        | Roles                                   |

`noAccess < read < edit < write`, ranked, each level implying every level below it. `edit` changes something that already exists; `write` also creates and destroys.

The split falls on the mutation, not the category:

| Level   | Mutations                                                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `edit`  | `patch-card-state`, `edit-card`, `edit-dashboard`, `edit-theme`, `edit-integration`, `edit-card-mapper`, `insert-card`                          |
| `write` | `add-card`, `remove-card`, `add-theme`, `remove-theme`, `add-integration`, `remove-integration`, `remove-card-mapper`, `assemble-card-template` |

The point is `data: edit` alongside `cards: edit`: a caller may change what a card shows without being able to add or delete cards. Categories give blast radius by subject; levels give it by verb. `data: edit` ticks a task; `cards: write` adds, removes, retitles, or re-templates a card.

Enforcement stays one lookup (D14). The mutation carries its category tag; the required level is read off the mutation type, and both are compared against the caller's bundle by rank.

Consequence: `edit-*` mutations do not create what they cannot find. Creation needs an explicit `add-*`, which needs `write`. `add-theme` and `add-integration` exist because Settings manages both. Dashboards have no creation mutation.

Every writable thing in dashboard configuration maps to exactly one category. What belongs to one user maps to none of them (D35).

### D21 — One dashboard; it is not a multi-dashboard product

Decided 2026-09-01.

The application ships with one dashboard and offers no way to create or delete one. There is no mutation for either, and none is planned.

The dashboard arrives in the default configuration, and every entrypoint hangs off it — Settings is reached from the dashboard, so "no dashboard exists" is not a state the UI has to handle.

`dashboardConfigurationSchema` holds `dashboard`, one object, not an array. D9's shape is unchanged: a dashboard is a document holding ordered card references plus a theme reference, and a card sits in one pool. The dashboard keeps its `id`, and `insert-card` still names it.

Consequence: `edit-dashboard` is the only dashboard mutation. It reorders card references and changes the theme reference.

### D22 — The service assembles a card template's component from a composition tree

Decided 2026-09-03.

The service can assemble a card template's component source from agent input, gated like any other mutation (D37 names the permission). The agent never writes code.

The input is a declarative composition tree — `{component: string, props: Record<string, unknown>, children: Node[]}` — describing which of the declared library's components to nest and with what props. The service assembles real source from it: real imports, real JSX, using the component names and props as given, and emits it as a registry item (D32).

Correctness comes from the library itself, not a hand-authored parallel schema. The assembled file is checked by `tsc --noEmit` (already in `npm run check`) against the library's real types — that is the entire props and children correctness check. A hand-maintained duplicate of those types would drift from them. The input schema stays small and library-agnostic by construction: it describes tree shape, not any one library's vocabulary.

Scope: **static trees only.** A tree of `{component, props, children}` cannot express local state or callbacks — there is no way to represent a hook, or a stepper's `useState`. A card template that needs those stays hand-written. Drag-and-drop is out of scope for the assembled path.

One mechanism, not two: hand-written or assembled, a card template is real composition of the declared library either way.

### D23 — A dashboard declares its component library at initialization

Decided 2026-09-04.

A dashboard is built against one presentational library, named once when the dashboard is initialized, alongside the rest of the starting dashboard configuration (D9). This is an initialization-time declaration, not a mutation: nothing in the service surface changes which library a dashboard renders through, the same way nothing changes a role (D19).

The declared library fixes what a theme (D10) can say. `add-theme` and `edit-theme` pick values from the library's own vocabulary — its CSS variables, its utility classes — never arbitrary CSS. A theme's settings are a selection within the declared library, not a stylesheet.

Rationale: the same reasoning as D22's correctness argument, applied to styling instead of structure. Letting a mutation or a card template introduce CSS ad hoc would mean re-deriving what "in bounds" means per call. Naming one library once and constraining every later styling choice to its vocabulary keeps that vocabulary checkable and reviewable, the way `tsc --noEmit` checks D22's composition trees against the library's real types.

### D24 — A running dashboard serves its own card templates as a shadcn registry

Decided 2026-09-04.

Each dashboard's own server (`src/server`) serves its wired-in card templates (D22) as a shadcn-compatible registry (https://ui.shadcn.com/docs/registry/mcp): an index at `/r/registry.json`, each template's built payload at `/r/<name>.json`. Any shadcn-aware client — including one connected over `shadcn mcp` — can search, view, and add a template from a running dashboard the same way it would from shadcn's own registry.

The registry is per-dashboard, not per-repo: it's generated by the server process at request time from `includedCardTemplates` (`src/client/cards/index.ts`), the same map that decides which templates are real. A directory scan was rejected — the templates directory also holds a view component, an index module, tests, and in-flight `__assemble-*` files from a concurrent `assemble-card-template` call; scanning it would surface those as items. `includedCardTemplates` is the one place that already answers "which templates are real," so the registry reads that, not the filesystem.

Several templates can share one source file. Because a registry item's file content is the whole file it names, `cardTemplateSourceFiles` (sibling export next to `includedCardTemplates`) maps each template to the file it actually lives in, rather than guessing `<name>.tsx`.

The index lists items without file content (metadata only: name, type, dependencies); each item's own `/r/<name>.json` inlines the real source as `content`. `dependencies` and `registryDependencies` are derived from the template's own imports (`@/components/ui/<name>` for shadcn/ui primitives) rather than hand-maintained, so they can't drift from the source that actually ships.

Rationale: the registry only needed to answer "what can a client search, view, and add from this dashboard" — not also host arbitrary write/download. Discovery plus `add` closes the loop shadcn's own CLI expects; nothing further was built. Deriving everything (which templates exist, what file they're in, what they depend on) from data the codebase already maintains for other reasons is the same locality argument as D23: one source of truth, checkable, no second list to keep in sync by hand.

### D25 — shadcn/ui is the framework

Decided 2026-09-04.

shadcn/ui is the framework this project is built on. shadcn components are the default. Tailwind CSS is the default theming framework. Where this project states no default of its own, shadcn/ui's default is the default.

A card template composes shadcn's components directly. There is no headless structural layer beneath them wrapped in shadcn's classes.

`react-aria-components` is not part of this project's direction. That is a statement about direction, not about the library: it is actively maintained, and only individual props inside it carry `@deprecated`. What was stale is this codebase's reliance on it, which D32 removes.

D23's shape is unchanged: one presentational library, declared once at initialization, fixing what a theme can say — with Tailwind and shadcn's tokens as that vocabulary.

### D26 — Every colour is a semantic token; base colour is per-user

Decided 2026-09-04.

A user can change the base colour, and that one change recolours the whole project. Two halves make that work.

**Every colour is a semantic token.** Every colour in a card or a component is a CSS semantic variable from the Tailwind/shadcn token set — `background`, `foreground`, `primary`, `muted-foreground`, `border`, `card`, and the rest. No hex literals, no palette-scale utilities (`bg-neutral-800`, `text-blue-500`), no per-card colour of its own. This is what makes one base-colour change propagate everywhere instead of reaching only the components that happened to be written against it; it is the colour counterpart of D23's rule that a theme selects from the declared library's vocabulary rather than writing CSS.

**Base colour is persistent and per-user.** The same card showing the same data renders in different base colours for different users. Base colour is therefore a property of who is looking, not of the card, the dashboard, or the data.

**Presets.** `admin` adds colour presets available to everyone; a user may add their own, which no permission gates (D27, D35).

Mechanism note, verified against the shadcn CLI: shadcn's own presets (`components.json`'s `tailwind.baseColor`, `shadcn apply --preset`) are a **build-time** operation — the CLI rewrites config, CSS variables, and component files on disk. That is not a per-user runtime switch and cannot be one. A per-user base colour is served by scoping the token values themselves — the `oklch(...)` definitions sitting in `:root` and `.dark` — to the current user at runtime. The semantic-token rule above is what makes that scoping sufficient. `components.json` remains the project's build-time default, not the per-user mechanism.

### D27 — Per-user configuration lives in the user's own env files

Decided 2026-09-04.

**Where per-user configuration lives.** Each user has their own `.env` file or files, holding their preferences — base colour and typeset (D33). Dashboard configuration stays shared, holding what everyone sees. Secrets never live there (D28).

**Base colour modifies a theme.** Base colour is not a peer of a theme and not an independent layer over one — it is a modifier of the theme. It controls the default token values generated for the project at `init` or when a preset is applied.

**Preset format.** A preset follows the format in `globals-example.css`: the `@theme inline` block mapping `--color-*` to the bare token names, then `:root` and `.dark` blocks defining every token as an `oklch(...)` value, then the `@layer base` rules. A preset is a whole token set in that shape, not a partial override.

**Who adds presets.** `admin` adds presets available to everyone (D35). A user may also add their own; their own presets are user-owned and not governed by the permission matrix.

**Generation is build-time only.** Nothing generates token values at runtime. A custom theme defines every semantic-variable-to-colour pair explicitly, in the `globals-example.css` format, so there is nothing left to generate from it. Base colour's generating role applies at `init` and preset-apply; from then on a theme is a complete, literal token set.

Per-user base colour is therefore selection among complete token sets, not per-user generation. What a user's configuration holds is which set applies to them.

### D28 — Credentials are stored by best practice, not by hand

Decided 2026-09-04.

Credential storage uses an established approach for each of the two problems here. Neither is hand-rolled, and neither is a plaintext file.

**Account credentials — hashed, never stored.** This dashboard's own auth only ever needs to _verify_ a credential, so the credential is not stored at all: a hash is. Node's built-in `crypto.scrypt` derives it and `crypto.timingSafeEqual` compares it, so no dependency is added.

**Integration tokens — encrypted at rest.** A third-party auth token must be recoverable to be sent in an `Authorization` header, so hashing is not available. Tokens are encrypted at rest with AES-256-GCM under a key held outside the data directory, decrypted in memory at request time and never written back in the clear.

`CredentialStore` is the single seam every path goes through to reach a stored secret, with one implementation behind it.

**Preferences and secrets are stored differently.** A user's env files hold preferences. Secrets never go there.

The encryption-at-rest choice follows from D29: users share one dashboard and one set of card data, so there is a shared server process rather than a dashboard per machine. An OS secret store (Keychain, DPAPI, libsecret) would be the better answer for a dashboard running locally per user, and this decision should be revisited if that topology ever becomes the real one.

Secrets live on the server host, in the same place as the server (D30) — never with a client.

**Key rotation: every 90 days.** The encryption key is rotated on a 90-day policy. Rotation re-encrypts every stored token under the new key; a stored token carries the identifier of the key it was sealed under, so a token written before a rotation is still readable while the re-encryption pass runs. Old keys are destroyed once no stored token references them.

90 days is a starting figure, chosen to be a policy rather than an absence of one. It is not derived from a threat model and can be shortened without anything else changing.

### D29 — An integration is a shared interface; each user supplies their own token

Decided 2026-09-04.

Several users share one dashboard. Each contributes data to it — from their own third-party integrations, and from manual or agentic input — and what any user contributes is visible to every user.

**An integration is a shared interface with per-user authorization.** The integration — its type, its query surface, its adapter — is shared and defined once. What is per-user is the authorization: each user supplies their own auth token for it. Two users connected to the same kind of service are using one integration interface with two tokens, not two integrations.

**Queries are user-specific.** A user supplies one or more queries to run against their own authorized connection, so a query carries whose token it runs under.

**Results are shared.** A query's result, once mapped and stored as card state, is visible to every user of the dashboard. Data enters through one user's authorization and becomes common to all of them. This is intended, and it is the reason the dashboard has more than one contributor.

This is a deliberate privacy posture, recorded so it is not mistaken for an oversight: a user who authorizes an integration is contributing its data to a shared surface, not viewing it privately. Anything a user does not want every other user to see must not be brought in through a query.

D21's single dashboard is unaffected: one dashboard, several contributors.

### D30 — Last write wins; adapters receive user secrets

Decided 2026-09-04.

**Last write wins.** When two users' queries write the same card's state, the most recent write is the state. No merge, no designated contributor, no version check — consistent with D13, which took versions and staleness checks out of the model entirely.

This is a deliberate simplification with a known ceiling, not a claim that conflicts do not matter: two contributors to one card can overwrite each other and neither is told. The implementation carries a `ponytail:` comment naming the ceiling so the shortcut is tracked rather than forgotten.

**Adapters receive user secrets at update time.** An integration adapter is passed the relevant user's secret when an update fires. The existing `tokenProvider` seam already carries a token to an adapter per call; it gains the user dimension rather than being replaced.

**A user's own queries are not governed by the permission matrix.** They belong to that user by structure (D32, D35), so no category or level gates them. The one role-gated action against another user's queries is deletion, held by `admin`.

**Secrets are stored on the server host,** in the same place as the server, not with any client.

**A user may only supply queries under their own identity.** Because a query runs under the token of the user it belongs to, writing a query as another user would cause fetches under that user's authorization — a privilege escalation across users. Enforced at the one enforcement point (D4), like every other check.

### D31 — A user's queries are visible only to that user

Decided 2026-09-04.

A query is visible to the user who supplied it and to nobody else. Query _results_ remain shared — that is D29 and does not change. What is private is the query itself: which integration a user draws from, and what they ask it for.

The reason is that a query is revealing in a way its result is not. A shared calendar card says what is on the calendar; the query behind it says whose calendar, filtered how, searched for what. D29 made results common deliberately. It did not intend to make every user's search terms common as a side effect.

The storage boundary does this work directly (D32): a caller reading their own user data reads their own queries, and there is nothing of anyone else's to filter out.

Refresh runs server-side under each query's owner's token (D30), so what a caller can read does not stop another user's queries from running.

### D32 — Queries live with user data; the assembler emits registry items

Decided 2026-09-04.

**Queries live with user data.** A query is stored with the user who supplied it, not on the card. A card carries no queries at all. Only the owning user reaches their queries; the one exception is deletion, which `admin` may also do (D35). Nothing else reaches them — not read, not edit.

This makes D31's privacy outcome structural rather than enforced by filtering. There is no shared object holding another user's queries, so there is nothing to redact on read.

**The card-template assembler emits registry items.** `assemble-card-template` (D22) produces a registry item conforming to the shadcn registry item schema — `name`, `type`, `files`, `dependencies`, `registryDependencies`, and the optional install-time fields — rather than a bare `.tsx` file. The assembler's output and the registry's served items are the same artifact in the same shape, instead of the registry wrapping raw source after the fact.

**`react-aria-components` leaves `package.json`.** D25 made its use stale; this removes it, outright rather than deprecated.

**`@base-ui/react` stays.** It is not shadcn's substrate — shadcn is not tied to Base UI at all. `components.json` carries a `base` field of `radix` or `base` that "determines component APIs and available props", and the `shadcn` package itself depends on neither: the primitive library arrives with the components the CLI writes. The two APIs differ enough to need their own ruleset (`asChild` versus `render`, Select's `items`, Slider scalar versus array).

This dashboard chose the `base-nova` preset, so `src/components/ui/{badge,button,separator}.tsx` import Base UI directly and removing it breaks them. Moving to Radix would be a preset change, not a package edit.

shadcn is strictly React: every template it offers is a React one — `next`, `vite`, `start`, `react-router`, `astro` — and the Vue and Svelte ports are separate projects.

**The theme schema is defined by Tailwind CSS and shadcn/ui.** The shape of a theme is not this project's invention — it is the token vocabulary those two define (D33).

**The original five card templates are deleted.** `message`, `table`, `list`, `calendar`, and `chart` are gone. They rendered raw HTML with no styling, predated every decision from D25 onward, and were not a base to build on. What fell out of that, recorded because a dashboard that renders nothing is a surprising state to find the tree in:

- `cardTemplateSchemas` is empty, and a card template name is now validated by membership in it rather than by a fixed enum — `z.enum` needs at least one member.
- `defaultDashboardConfiguration` ships no cards and an empty dashboard, since no template exists for one to name.
- The registry serves an empty index. That is correct rather than broken: it reports what this dashboard actually has.
- `formatMessage`, the built-in mapper for the `message` template, went with it. `formatIdentity` stays.
- The deleted schemas moved to `src/test-support/card-template.ts`, out of the shipped product. Tests about the service, the contract, and the registry are not about which templates ship — they need only that one exists — so they register a fixture rather than being deleted alongside it.

### D33 — A theme's settings are a typeset and the presentational half of `components.json`

Decided 2026-09-04.

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

**There is no `fontScale`.** `--typeset-size` is that setting with a better vocabulary, so font scale is part of the user's typeset, read from their own configuration (D27), rather than a number in dashboard configuration.

### D34 — `components.json` is per-user, generated by extending a server-owned template

Decided 2026-09-04.

There is one `components.json` in the repository today, shared by everything. It becomes per-user: each user has their own, produced by extending a server-owned base template rather than written from scratch or edited in place.

The server template carries the structural fields — `aliases`, `rsc`, `tsx`, `tailwind.config`, `tailwind.css`, `tailwind.prefix`, `registries`, `$schema`. A user's extension carries the presentational ones — `style`, `tailwind.baseColor`, `tailwind.cssVariables`, `iconLibrary`, `rtl`, `menuColor`, `menuAccent`. That is D33's split, expressed as a file layout instead of a rule: a user cannot reach a structural field because their file does not contain one.

**Why extension rather than mutation.** shadcn's own documentation (https://ui.shadcn.com/docs/components-json) states that `style`, `tailwind.baseColor`, and `tailwind.cssVariables` cannot be changed after initialization. Those are exactly the fields a user owns. A per-user `components.json` therefore cannot be a document edited over time — it has to be generated at that user's initialization, from the server template plus that user's choices, and regenerated rather than patched when they change. This is the same rule D26 already set for colour: generation happens at build time, and what exists at runtime is a complete, literal artifact.

Doc-version caution: the page above lists `style` as accepting only `new-york` and omits `iconLibrary`, `menuColor`, `menuAccent`, and `rtl`, while this repository's `components.json` already uses `base-nova` and carries all four. The page lags the CLI. Treat the shipped `components.json` and `shadcn --help` as the truth for which fields exist, and the doc for what each one means.

Reference: https://ui.shadcn.com/llms.txt indexes shadcn's documentation and is the entry point for looking any of this up. Recorded in `AGENTS.md`.

### D35 — Two roles, `admin` and `user`; user-owned things leave the permission matrix

Decided 2026-09-04.

**The matrix governs shared and server-owned things only.** Anything that belongs to one user — their queries, their base colour, their typeset, their own presets — is theirs by structure and is not gated by a category or a level. A user does not need a permission to change their own appearance or supply their own query, because nothing else can reach those in the first place (D32, D33). The one exception is a card mapper, which a user writes into a shared store (D38).

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

**Roles are not part of dashboard configuration.** `persistence.write` serializes that whole object on every applied batch, so a role living there would be data in a file the service rewrites rather than a file the source imports, and the trust level above would not be real.

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

The reasoning is the same as the roles file above: the OS user running the process can edit the roles file, the dashboard data, and the source, so withholding permissions from them through the application would be theatre. Nothing is defended by it. A caller who is not that user is defended against, and starts from nothing.

**How the local user is proved.** Loopback is not proof: the server binds `127.0.0.1`, which shows the caller is on the same machine, not that it is the same OS account. The proof is a random token written at startup to `.dashboard/local-user-token` — reading that file is the check, and the filesystem enforces it.

Each door proves it differently, for the same reason:

| Door                 | How the caller is the local user                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `mcp`, over stdio    | By construction. Spawning the process already required being that OS account, and there is no port to reach it on.          |
| the browser, on HTTP | The server prints `http://127.0.0.1:<port>/?token=…` to its own stdout. Only whoever can read that stdout is the same user. |

The page stores the token in `sessionStorage` and strips it from the address bar, then sends it as a bearer credential. Another OS account can still open the port and load the page, but never receives the token, so it proves nothing and resolves to no permissions — not to the local user, as loopback alone would have given it. This is how Jupyter authenticates a local notebook.

A build with no token provisioned treats an unproven caller as the local user, since there is then no door at which anything could be proved. `service` decides this from whether `localUserToken` is set.

**Each platform restricts the file its own way.** POSIX gets `chmod` 0600. Windows cannot: `chmod` there maps onto the read-only flag, so a token written with mode 0600 lands readable by everyone. Measured on this repository, a plain file under `.dashboard/` carries inherited entries for `BUILTIN\Users` and `NT AUTHORITY\Authenticated Users` — every account on the host. Windows therefore gets `icacls <path> /inheritance:r /grant:r <user>:F`, which drops the inherited entries and leaves one name on the file.

If the `icacls` call fails, the failure is written to stderr and startup continues: the dashboard runs and the token still authenticates, and only the file's protection is lost.

`ls` under a POSIX emulation on Windows still prints `-rw-r--r--` for the hardened file. It is reading a translation, not the ACL; `icacls` is what says what is true.

### D36 — A card template is a registry item; agents compose primitives

Decided 2026-09-05.

**The vocabulary is shadcn's.** A card template is a registry item — the same
unit shadcn distributes, serves, and installs. Nothing about it is this project's
invention, and its fields are whatever
<https://ui.shadcn.com/schema/registry-item.json> says they are.

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

### D37 — Adding a card template takes `cards: write`, which `admin` holds

Decided 2026-09-05.

Adding a card template is `admin`'s to do. The permission is `cards: write`
(D35) — what `assemble-card-template` requires, and what governs a hand-written
one too.

The two paths are not differently governed, one by a permission and one by
repository access. Hand-writing a card template is the same authority exercised
at source, and code review checks the work rather than granting the right to do
it.

Built-in card mappers and packages stay source-only, reachable by no role.

Consequence for `user`, which holds `cards: read`: a user cannot add a card
template by either path.

### D38 — A card mapper is the mapping, and mappers live in a shared store

Decided 2026-09-05.

**The term.** A **card mapper** is Fowler's mapper: an object setting up a
correspondence between two schemas that stay independent of each other. The
artifact does not format anything; it restates a shape.

Named for what it maps _to_. What it maps _from_ is any structured data source,
not only an API response, so naming it after the source would be too narrow.

`formatter` is not recycled. It stays free for business logic that changes data
before it reaches a card — a different thing, not defined here.

**The home: one shared store, referenced by name.** A card mapper lives in a
store that cards import from; a card names one rather than carrying a copy. Two
queries needing the same mapping name the same mapper instead of each holding a
duplicate.

A query still names its own integration and still runs on its own, and two
queries against one calendar still fetch separately and hold their own results
(D11). What is shared is the mapping between them, not the fetching.

Adding under a name already in the store fails rather than overwriting.

**Who writes one.** A user does, and adding one is not gated by the permission
matrix. This narrows D35: the store is shared, so this is an ungated write to a
shared object, which D35's rule would otherwise govern. The reason is that a
mapper is a declarative spec rather than code, and a user who cannot write one
cannot make their own query render at all — the capability is inseparable from
supplying a query, which is already theirs.

Changing or deleting a mapper another card already references is a change to
something shared, and takes `cards: write`.

**Unchanged.** A card mapper is still deterministic, still runs on the way in,
still `"identity"` or a bundled function or a declarative spec, and built-in
mappers are still source-only.

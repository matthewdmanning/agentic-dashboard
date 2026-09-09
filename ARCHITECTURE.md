# Architecture

How this application is built and where each concern lives. Terms used here are defined in [`CONTEXT.md`](CONTEXT.md).

## Central principle

The service exposes one interface. The client and the MCP server are two consumers of that same interface, with no privileged path between them, so a permission or authentication check covers every caller rather than one door of several.

The dashboard is not one fixed object or universal data model. Its structure, data relationships, cards, presentation, and integrations may change when an agent implements the user's request.

## Technical direction

- The frontend uses React, TypeScript, and Vite.
- shadcn/ui is the framework the interface is built from; its components are the default and its own defaults are this project's defaults.
- Tailwind CSS is the theming framework.
- The interface is authored by composing that library's primitives. Raw HTML elements and hand-written CSS are not an accepted substitute for a composition — no agent may submit them in place of one. What a browser finally renders is HTML either way; what is authored is not.
- A small Node.js backend provides atomic JSON persistence, external-service integrations, external-access authentication, and MCP tools.
- There is no database.

## Module map

Seven modules, as they exist today:

| Module           | Owns                                                                                                                                                                                 | Lives at                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `contract`       | Dashboard configuration shape and validation, mutation types, card mapper compilation, card template schemas, role bundle shape. No React, no Node — imported by every other module. | `src/contract/`                                                                                             |
| `service`        | The one interface. Role resolution and enforcement, persistence, applying mutations.                                                                                                 | `src/service/`                                                                                              |
| `auth`           | Accounts, credentials, account-to-role resolution. Separate store from dashboard data.                                                                                               | `src/auth/`                                                                                                 |
| `integrations`   | File-backed integration catalog, per-user connections, credentials, retention policy, external-service adapters, and backup targets.                                                 | `src/server/integrations/`                                                                                  |
| `client`         | React application: rendering the active build, Settings, integration notices, offline cache, mutation queue, toast.                                                                  | `src/client/`                                                                                               |
| `card-templates` | Registry items paired with JSON Schemas, the atomic build/publish module, and card-template assembly. Post-initialization assembly takes `cards: write`, held by `admin`.            | `src/card-templates/` (build, codegen); `src/client/cards/` (`CardView`, template map, wired-in components) |
| `mcp`            | Tool definitions. Calls `service`.                                                                                                                                                   | `src/mcp/`                                                                                                  |

Runtime dashboard data, the integration catalog, card-template candidates and
active builds live at configurable paths outside `src/`. Roles live in a file
`contract` imports; per-user appearance lives in its own file-backed store,
one record per user; `components.json` stays the single project-root file,
unaffected by any user's record; secrets live in the credential store. None
of those is source code.

The active card template is `message`, at `src/client/cards/message.tsx`,
named by the default configuration's `welcome` card and served by the
registry. Deleted card-template schemas are kept for tests at
`src/test-support/card-template.ts`.

## Card templates in the codebase

A card template is split across two places, and both halves must agree:

- `contract` holds each template's schema.
- The card template's component renders data fitting that schema.

The component half travels as a registry item paired with a mandatory JSON
Schema, which is also what the registry serves and what the assembler emits.
An item is not limited to one component file: a hand-written
card template that needs a hook, a utility module, or its own tokens and
stylesheet rules ships them in the same item, as `registry:hook`,
`registry:lib`, `cssVars`, and `css`. The assembled path cannot — a
composition tree expresses no hook — so an item carrying one is hand-written.

Initialization generates the default templates from the project's shadcn/ui
configuration. After initialization, assembling another is governed by
`cards: write`, which `admin` holds and `user` does not.
Hand-writing one is a source change governed by repository access and review,
not by an application role.

A card template's component is a declarative composition of the declared
library's components — a tree of real component exports with props and nested
children, not free-form JSX, not raw DOM elements, not invented primitives. The
service can assemble one from a JSON Schema plus a composition tree
(`{component, props, children}`). It generates a registry item — real source
in the shadcn registry item shape, `name`, `type`, `files`,
`dependencies`, `registryDependencies` — and pairs it with the schema.
Correctness comes from JSON Schema validation and `tsc --noEmit` against
the library's real types, not a hand-maintained per-component prop schema.

The card-template build module takes a complete candidate set, builds it, and
atomically promotes its manifest and client assets only on success. The
mutation waits for that result. Open pages stay on their loaded build; the next
reload receives the promoted one.

This is broken for the client today. The registry endpoint reads the promoted
manifest at request time, so a newly assembled template is served immediately.
`CardView` does not: it renders from `includedCardTemplates`, a `components`
map compiled into `src/client/cards/index.ts` from the static
`activeCardTemplateManifest` object in `src/card-templates/manifest.ts`.
Nothing rebuilds that map or that object from the promoted manifest or client
build. A reload after assembly still shows only the templates wired in at
compile time — the registry and `CardView` can drift, and currently do.

Scope: static trees only. A widget needing local state or hooks (a stepper's `useState`, a drag-and-drop list's own state) can't be expressed as a composition tree and stays hand-written. Hand-written templates are source changes governed by repository access and review; `cards: write` governs only post-initialization assembly. Drag-and-drop is out of scope for the assembled path. Both paths still produce the same shadcn registry-item unit and enter the dashboard through the same rebuild and manifest.

A dashboard declares one presentational library — shadcn/ui — once, at initialization. Hand-written and assembled card templates both compose that library's components directly; there is no separate structural layer beneath it. A theme can only select values that library defines — Tailwind and shadcn's tokens — never arbitrary CSS.

Every colour a card template names is a semantic token from that set, never a hex literal or a palette-scale utility. A card template therefore has no colour of its own: changing the base colour recolours it without touching its source, so one card's source serves every user at once, each seeing their own.

Base colour modifies a theme, controlling the token values generated at initialization or when a preset is applied. A preset is a whole token set in the format of `globals-example.css`, never a partial override. `admin` adds presets for everyone; a user may add their own, which no permission gates.

There is one `components.json`, at the project root, identical for every
user — users do not get their own, and cannot have custom cards or custom
components: card templates and the component set are project-owned. A user
owns runtime appearance; the project owns choices that change generated
source. `style`, `tailwind.cssVariables`, `iconLibrary`, and `rtl` are
project-owned, set once in the root file. Base colour, typeset, `menuColor`,
`menuAccent`, and personal presets are user-owned and constrained to shadcn's
vocabulary, but never touch `components.json` — they're stored per user
(`AppearanceStore`) and expressed as CSS token values through the cascade
(`appearanceCss`), so two users loading the dashboard see the same card
templates and the same component set, differing only in these tokens.

A running dashboard also serves its own wired-in card templates as a shadcn-compatible registry, over HTTP at `/r/registry.json` and `/r/<name>.json` — any shadcn-aware client, including one connected over `shadcn mcp`, can search, view, and add a template straight from the running dashboard.

## Rendering path

Data reaches the screen through a fixed path:

1. A query runs against its integration, under the auth token of the user who supplied it.
2. The card mapper the query names — resolved from the shared store — maps the result onto the card template's display-role keys.
3. The result is validated against the card template's schema and stored as the card's state.
4. The card template's component renders that state directly.

The card mapper runs on the way in, not at render time, so a card is never persisted with data its template cannot render, and rendering is a straight read with no transform.

Several users share one dashboard, each contributing through their own authorized integrations, through manual edits, and through an agent acting on their behalf. All three arrive as mutations against card state, so no path is privileged over another. A query lives in the one shared query store, its integration and parameters encrypted at rest under its owner, and the adapter is passed that user's secret when an update fires. A result entering through one user's token becomes card state every user sees: authorizing an integration contributes its data to a shared surface. When two users' queries write the same card, the last write wins.

## Service surface

The service's configuration interface exposes two operations: `read(scope)`
returns state, and `apply(mutations)` applies one or more mutations atomically.
MCP tools and client actions are both mutation constructors. Authorizing and
disconnecting a user's connection are separate live credential handoffs on the
same service interface, so secrets never enter the mutation or offline-queue
formats.

Mutations change cards, the dashboard, themes, integrations, and the card mapper store. They never change roles, built-in card mappers, or packages — those are source changes, unreachable through the service at any permission level. Card templates are the one exception: the service can assemble a complete registry item from a mandatory JSON Schema and declarative composition tree, gated by `cards: write`.

Every request resolves to an account, then a role, then permissions, at one enforcement point. Access is governed in five categories — `data`, `cards`, `presentation`, `integrations`, `roles` — each holding `noAccess`, `read`, `edit`, or `write`, ranked so each level implies the ones below it.

`edit` changes something that already exists; `write` also creates and destroys. A role with `cards: edit` can retitle a card and change what it shows but cannot add or remove one. A mutation's category and required level both follow from its type, so a caller states only its payload and one lookup decides what the caller's bundle must hold.

The matrix governs shared and server-owned things only. What belongs to one user — their queries, base colour, typeset, menu choices, and own presets — is theirs by structure, and no category or level gates it. Adding a card mapper is ungated for the same reason, even though the store it lands in is shared: a user who cannot write one cannot make their own query render. Changing a referenced mapper takes `cards: write`; deleting one returns `in-use` until its references are removed.

Two roles ship as defaults: `admin` (`write` on `data`, `cards`, `presentation`, `integrations`; `read` on `roles`) and `user` (`write` on `data`, `read` on `cards`, `presentation`, and `integrations`, `noAccess` on `roles`). Roles are configured by editing a roles file the source imports — the same access as editing source code — not through the service. They do not live in dashboard configuration.

A caller with no credential resolves to full permissions if it is the local user and to none otherwise. Proof is a token written at startup to `.dashboard/local-user-token`, restricted to the owning account — `chmod` 0600 on POSIX, `icacls` on Windows, where `chmod` grants nothing. `mcp` over stdio is the local user by construction; the browser receives the token in the URL the server prints to its own stdout. Loopback is not itself proof: another OS account on the host can reach the port.

Account credentials are stored only as a `crypto.scrypt` hash and compared with `crypto.timingSafeEqual`; integration tokens are encrypted at rest on the server host under a key rotated every 90 days, each naming the key it was sealed under so a rotation needs no flag day. `CredentialStore` is the single seam every path goes through to reach a stored secret.

`integrations` governs the shared catalog, adapters, blocking, removal, and
retention policy. A user's connection is theirs by structure and needs no
permission. Default and recommended catalog entries persist; unused dynamic
entries expire after the project-configured retention period, initially 30
days. A blocked integration cannot connect or refresh, and every affected user
sees a persistent notice. An administrator can force removal after a high-level
warning; credentials are destroyed and private queries become unavailable
rather than being deleted.

Queries live in one shared store, not on a card. Only the owning user reaches them; `admin` may additionally delete them. Privacy comes from encrypting each query's integration and parameters under its owner and decrypting only in memory when a refresh needs it, rather than from which file a query sits in.

`read("role")` returns the caller's own resolved role and is never gated — a caller may always see what it may do, which is not the same as reading the role list.

A failed call carries the service's own name for the failure — a denial, an unknown id, something still in use — so an adapter maps that name to its own vocabulary rather than matching on message text.

`read(scope)` returns one category, or `all` for every category the caller may read — denied categories are omitted rather than failing the whole call, so a role short of one category still loads a dashboard. A consumer of `all` therefore holds a partial configuration, and must tell an omitted category from an empty one rather than filling the gap.

The client reaches the service over one endpoint pair, one operation each. There is no endpoint per action: every client action is a mutation, so a new action needs no new route and no second permission check.

Mutations in `integrations` require a live service. Every other mutation queues offline and replays on reconnect. `roles` has no mutations to queue.

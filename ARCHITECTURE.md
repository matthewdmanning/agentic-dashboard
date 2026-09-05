# Architecture

How this application is built and where each concern lives. Terms used here are defined in [`CONTEXT.md`](CONTEXT.md).

## Central principle

The service exposes one interface. The client and the MCP server are two consumers of that same interface, with no privileged path between them, so a permission or authentication check covers every caller rather than one door of several.

The dashboard is not one fixed object or universal data model. Its structure, data relationships, cards, presentation, and integrations may change when an agent implements the user's request.

## Technical direction

- The frontend uses React, TypeScript, and Vite.
- shadcn/ui is the framework the interface is built from; its components are the default and its own defaults are this project's defaults (D25).
- Tailwind CSS is the theming framework.
- The interface is authored by composing that library's primitives. Raw HTML elements and hand-written CSS are not an accepted substitute for a composition — no agent may submit them in place of one. What a browser finally renders is HTML either way; what is authored is not.
- A small Node.js backend provides atomic JSON persistence, external-service integrations, external-access authentication, and MCP tools.
- There is no database.

## Module map

Seven modules:

| Module           | Owns                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contract`       | Dashboard configuration shape and validation, mutation types, card mapper compilation, card template schemas, role bundle shape. No React, no Node — imported by every other module. |
| `service`        | The one interface. Role resolution and enforcement, persistence, applying mutations.                                                                                                 |
| `auth`           | Accounts, credentials, account-to-role resolution. Separate store from dashboard data.                                                                                               |
| `integrations`   | Optional, user-authorized external-service connections, and backup targets.                                                                                                          |
| `view`           | React application: rendering, Settings, offline cache, mutation queue, toast.                                                                                                        |
| `card-templates` | Card template components, paired with their schemas from `contract`. Split out on change cadence: adding one takes `cards: write`, held by `admin` (D37).                            |
| `mcp`            | Tool definitions. Calls `service`.                                                                                                                                                   |

Runtime dashboard data and installed themes live at a configurable path outside `src/`. Roles live in a file `contract` imports; per-user preferences live in each user's own `.env` files; secrets live in the credential store. None of the three is dashboard configuration.

## Rewrite in progress

The module map above is the target cut. The rewrite lands issue by issue, so parts of `src/` do not match it yet:

| Module           | State                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `contract`       | Written, at `src/contract/`                                                                                                               |
| `service`        | Written, at `src/service/`                                                                                                                |
| `auth`           | Written, at `src/auth/`                                                                                                                   |
| `mcp`            | Rewritten onto `service`, at `src/mcp/`; tested                                                                                           |
| `integrations`   | Not split out; lives under `src/server/integrations/`                                                                                     |
| `view`           | Not renamed; lives at `src/client/`; on `service`                                                                                         |
| `card-templates` | Partly split out; the composition-tree codegen is at `src/card-templates/`, `CardView` and the template map remain at `src/client/cards/` |

**Zero card templates are wired in right now — a state of this rewrite, not a gap in the design.** The five that shipped were deleted (D32) and their shadcn replacements are not written, so `cardTemplateSchemas` is empty, the default configuration holds no card, the registry serves an empty index, and a running dashboard renders nothing. Their schemas were kept for tests at `src/test-support/card-template.ts`. Writing one is ordinary work against a mechanism that is already here.

Further gaps between the decisions and the tree: the assembler still emits a bare `.tsx` rather than the registry item D32 calls for; `react-aria-components` is still declared and still what that assembler generates against; a card still carries its queries and each query its own inline mapper, under the old name `formatter`; and `fontScale` still sits in dashboard configuration. [`agent-docs/implementation-spec.md`](agent-docs/implementation-spec.md) is the full list, phased.

Delete this section when the last module lands.

## Card templates in the codebase

A card template is split across two places, and both halves must agree:

- `contract` holds each template's schema.
- The card template's component renders data fitting that schema.

The component half travels as a registry item, which is also what the registry serves and what the assembler emits (D22, D24, D32). An item is not limited to one component file: a hand-written card template that needs a hook, a utility module, or its own tokens and stylesheet rules ships them in the same item, as `registry:hook`, `registry:lib`, `cssVars`, and `css`. The assembled path cannot — a composition tree expresses no hook — so an item carrying one is hand-written.

Adding a card template is governed by `cards: write`, which `admin` holds and `user` does not (D35, D37). The permission is the same whether the item is assembled from a composition tree or hand-written — writing one by hand is that authority exercised at source, where review applies as it does to any other source change, not a way around the permission.

A card template's component is a declarative composition of the declared library's components — a tree of real component exports with props and nested children, not free-form JSX, not raw DOM elements, not invented primitives. The service can also assemble one: given a composition tree (`{component, props, children}`), it generates a registry item — real source in the shadcn registry item shape, `name`, `type`, `files`, `dependencies`, `registryDependencies` (D22, D32). The assembler's output and the items the registry serves are therefore the same artifact. This is the one card-template capability the service has; built-in card mappers and packages stay source-only. Correctness comes from `tsc --noEmit` against the library's real types, not a hand-maintained parallel schema — the input tree carries no per-component vocabulary of its own.

Scope: static trees only. A widget needing local state or hooks (a stepper's `useState`, a drag-and-drop list's own state) can't be expressed as a composition tree and stays hand-written — under the same `cards: write` either way (D37). Drag-and-drop is out of scope for the assembled path. One mechanism either way — hand-written or assembled, upstream or in a differently-run copy of this codebase, the composition is the same real library.

A dashboard declares one presentational library — shadcn/ui — once, at initialization (D23). Hand-written and assembled card templates both compose that library's components directly; there is no separate structural layer beneath it (D25). A theme can only select values that library defines — Tailwind and shadcn's tokens — never arbitrary CSS.

Every colour a card template names is a semantic token from that set, never a hex literal or a palette-scale utility (D26). A card template therefore has no colour of its own: changing the base colour recolours it without touching its source, so one card's source serves every user at once, each seeing their own.

Base colour modifies a theme, controlling the token values generated at initialization or when a preset is applied (D27). A preset is a whole token set in the format of `globals-example.css`, never a partial override. `admin` adds presets for everyone; a user may add their own, which no permission gates.

A user owns appearance; the server owns data and card templates (D33). A theme's settings are a typeset — shadcn's typography system — plus the presentational fields of `components.json` (`style`, `tailwind.baseColor`, `tailwind.cssVariables`, `iconLibrary`, `rtl`, `menuColor`, `menuAccent`). That file's structural fields (`aliases`, `rsc`, `tsx`, `tailwind.config`, `tailwind.css`, `tailwind.prefix`, `registries`) stay server-owned and are unreachable through a theme.

`components.json` is per-user, generated by extending a server-owned template rather than edited in place (D34) — several of the fields a user owns cannot be changed after initialization, so a change regenerates the file. The split above is what the two halves of that extension hold.

A running dashboard also serves its own wired-in card templates as a shadcn-compatible registry, over HTTP at `/r/registry.json` and `/r/<name>.json` (D24) — any shadcn-aware client, including one connected over `shadcn mcp`, can search, view, and add a template straight from the running dashboard.

## Rendering path

Data reaches the screen through a fixed path:

1. A query runs against its integration, under the auth token of the user who supplied it (D29).
2. The card mapper the query names — resolved from the shared store — maps the result onto the card template's display-role keys.
3. The result is validated against the card template's schema and stored as the card's state.
4. The card template's component renders that state directly.

The card mapper runs on the way in, not at render time, so a card is never persisted with data its template cannot render, and rendering is a straight read with no transform.

Several users share one dashboard, each contributing through their own authorized integrations, through manual edits, and through an agent acting on their behalf (D29). All three arrive as mutations against card state, so no path is privileged over another. A query is stored with its owner's user data, and the adapter is passed that user's secret when an update fires (D30, D32). A result entering through one user's token becomes card state every user sees — a deliberate posture, not an oversight: authorizing an integration contributes its data to a shared surface. When two users' queries write the same card, the last write wins.

## Service surface

The service exposes two operations: `read(scope)` returns state, and `apply(mutations)` applies one or more mutations atomically. MCP tools and client actions are both mutation constructors.

Mutations change cards, the dashboard, themes, integrations, and the card mapper store. They never change roles, built-in card mappers, or packages — those are source changes, unreachable through the service at any permission level. Card templates are the one exception (D22): the service can assemble one's component from a declarative composition tree, gated by a permission level like any other mutation.

Every request resolves to an account, then a role, then permissions, at one enforcement point. Access is governed in five categories — `data`, `cards`, `presentation`, `integrations`, `roles` — each holding `noAccess`, `read`, `edit`, or `write`, ranked so each level implies the ones below it.

`edit` changes something that already exists; `write` also creates and destroys. A role with `cards: edit` can retitle a card and change what it shows but cannot add or remove one. A mutation's category and required level both follow from its type, so a caller states only its payload and one lookup decides what the caller's bundle must hold.

The matrix governs shared and server-owned things only (D35). What belongs to one user — their queries, base colour, typeset, own presets — is theirs by structure, and no category or level gates it. Adding a card mapper is ungated for the same reason, even though the store it lands in is shared: a user who cannot write one cannot make their own query render (D38). Changing or deleting a mapper other cards reference takes `cards: write`. Adding a card mapper is ungated for the same reason, even though the store is shared: a user who cannot write one cannot make their own query render (D38). Changing or deleting a mapper other cards reference takes `cards: write`.

Two roles ship as defaults (D35): `admin` (`write` on `data`, `cards`, `presentation`, `integrations`; `read` on `roles`) and `user` (`write` on `data`, `read` on `cards`, `presentation`, and `integrations`, `noAccess` on `roles`). Roles are configured by editing a roles file the source imports — the same access as editing source code — not through the service. They do not live in dashboard configuration.

A caller with no credential resolves to full permissions if it is the local user and to none otherwise (D35). Proof is a token written at startup to `.dashboard/local-user-token`, restricted to the owning account — `chmod` 0600 on POSIX, `icacls` on Windows, where `chmod` grants nothing. `mcp` over stdio is the local user by construction; the browser receives the token in the URL the server prints to its own stdout. Loopback is not itself proof: another OS account on the host can reach the port.

Account credentials are stored only as a `crypto.scrypt` hash and compared with `crypto.timingSafeEqual`; integration tokens are encrypted at rest on the server host under a key rotated every 90 days, each naming the key it was sealed under so a rotation needs no flag day (D28). `CredentialStore` is the single seam every path goes through to reach a stored secret.

`integrations` governs the integration — the service, its adapter, its query surface — which is shared. A user's own authorization to one is theirs by structure and needs no permission, the same as their queries.

Queries are stored with user data, not on a card (D32). Only the owning user reaches them; `admin` may additionally delete them. Because no shared object holds another user's queries, the privacy D31 requires falls out of the storage boundary rather than from filtering on read.

`read("role")` returns the caller's own resolved role and is never gated — a caller may always see what it may do, which is not the same as reading the role list.

A failed call carries the service's own name for the failure — a denial, an unknown id, something still in use — so an adapter maps that name to its own vocabulary rather than matching on message text.

`read(scope)` returns one category, or `all` for every category the caller may read — denied categories are omitted rather than failing the whole call, so a role short of one category still loads a dashboard. A consumer of `all` therefore holds a partial configuration, and must tell an omitted category from an empty one rather than filling the gap.

The client reaches the service over one endpoint pair, one operation each. There is no endpoint per action: every client action is a mutation, so a new action needs no new route and no second permission check.

Mutations in `integrations` require a live service. Every other mutation queues offline and replays on reconnect. `roles` has no mutations to queue.

# Architecture

What this application does. Terms are defined in [`CONTEXT.md`](CONTEXT.md); anything not defined there is shadcn's, and shadcn's documentation is the source.

## The product

A person builds a dashboard with the help of an AI agent. The agent adds tiles, arranges them, and connects them to data.

The same request given to different models should produce closely similar dashboards. That is the product. It is judged by eye, on the rendered result — not by comparing structures, since different compositions produce very similar appearances.

Every consequence below follows from that. A mechanism no model has seen before is a defect, however elegant, because learning it from project documentation is exactly where models diverge.

## What is deferred to shadcn

| Concern                                                           | Handled by                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Components, and where their files land                            | `shadcn add`, `components.json`                                                |
| Appearance — style, base colour, theme, typeset, icons, radius    | preset codes                                                                   |
| Packaging a tile's source for distribution                        | registry item, `shadcn build`                                                  |
| Discovering which tiles exist                                     | the dashboard's own registry, reached through `shadcn search` / `view` / `add` |
| Serving different content to different users                      | registry authentication, user-personalized registries                          |
| Referencing credentials                                           | `${NAME}` references, per shadcn's convention                                  |
| Identical shadcn instructions, for an agent working in a checkout | the pinned shadcn Agent Skill                                                  |

The project implements none of these. Anything it would have to invent to replace one of them is a defect.

Appearance is per-user: each person is served their own theme item from the dashboard's own registry, which is the documented pattern for personalizing what a registry returns.

## What the project owns

Five things shadcn has no opinion about.

1. **A data schema attached to a registry item.** A registry item carries no notion of the data it displays. This project puts a JSON Schema in the item's `meta`, derives the component's props type from it, and that pairing is the whole contract an agent works against. One source, one direction — the schema and the source it ships with cannot drift, because drift is a type error.
2. **Display-role keys and tile mappers** — getting arbitrary external data into the shape an item expects. A mapper is a plain function typed against the schema, gated by the same typecheck as the item's own source, so there is no mapping language for a model to learn.
3. **Placement** — which tiles are on a dashboard, in what order, at what size.
4. **Who may change what** — accounts, roles, and one enforcement point.
5. **Instructing the agent that connects.** The MCP server sends its own operating instructions when a client connects, and assumes that client has nothing installed. shadcn's Agent Skill reaches an agent working in a checkout; it does not reach one that connected over a socket, and most agents using a dashboard will never hold a copy of this repository.

The server cannot check whether a connected agent holds any given instructions — it cannot see inside a client. So it does not try. It sends them every time instead, which makes having them a property of connecting rather than of how the client was set up. Anything a connecting agent must know to use a tool correctly belongs in the instructions or in the tool's own description, never in a document it would have to go and find.

## How data reaches a tile

1. A query runs against its integration, under the credential of the user who supplied it. A credential is named, never held by the caller: resolution takes the name and the acting account together, because one name means different values for different people. The encrypted source behind it can be swapped without any caller knowing.
2. The tile mapper the query names reshapes the result onto the registry item's display-role keys.
3. The result is validated against that item's schema and stored as the tile's state.
4. The item's component renders that state directly.

Mapping happens on the way in, not at render time, so a tile is never stored holding data its item cannot render.

The browser converts the item's JSON Schema to a validator at load and checks state before rendering, so a tile added while the app is running renders without a rebuild.

Several people share one dashboard, each contributing through their own authorized integrations, through manual edits, and through an agent acting on their behalf. All three arrive as mutations, so no path is privileged. A result entering under one user's credential becomes state every user sees: authorizing an integration contributes its data to a shared surface. When two users' queries write the same tile, the last write wins.

## Changing a dashboard

One interface, two operations: read state, or apply one or more mutations atomically. Every action a person or an agent can take is a mutation, so a new action needs no new route and no second permission check.

`apply` reports which of two things happened — applied, or queued for replay. A caller is never left to work that out from whether it thinks it is online.

Mutations change tiles, the dashboard's references, integrations, and the tile mapper store. They never change roles, appearance, or packages — those are configuration or source changes, unreachable through this interface at any permission level.

Reads take a scope and return one category, or everything the caller may read. A denied category is withheld rather than failing the whole call, so a caller short of one category still loads a dashboard. The result says which categories it carries and which were withheld, so absence never has to be interpreted — a withheld category and an empty one are told apart by the interface, not by each caller.

A failed call carries the interface's own name for the failure — a denial, an unknown id, something still in use — so a caller maps that name rather than matching on message text.

A caller may always read its own resolved permissions. That is not the same as reading the role list.

Mutations touching integrations need a live connection. Every other mutation queues while offline and replays on reconnect, which is safe because a mutation describes a change rather than a result.

## Access

Every request resolves to an account, then a role, then permissions, at one enforcement point. There is no privileged path — an agent and a person go through the same door.

One decision covers every request. It takes the mutation's type, the acting account, and who owns the thing being changed, and returns allow or deny. A caller states only its payload.

The decision is built from predicates and guards, all in-process and pure. A predicate answers one question about a request — does this role hold this level, does this account own this entry. A guard pairs a predicate with the failure name its denial reports. One guard per mutation type sits in a table keyed by that type, which is what makes the scheme fail closed: a new member of the mutation union breaks the build until it declares a guard, so no mutation type can reach the store unchecked.

A request is permitted only when every gate that applies to it passes. A mutation on a tile's own record passes one gate: the level. A mutation on something owned — a query, a connection, an appearance setting, or an entry inside a tile's state — passes two: the level, and ownership by the acting account. Neither gate grants on its own. `write` on `data` passes the ownership gate for every entry. The same decision returns both gates.

Two roles ship by default: `editor`, which may write data, tiles, and integrations and read roles; and `contributor`, which may write data and read the rest — only `editor` can change a tile at all. A caller with no credential is denied outright — the dashboard is internet-facing, so there is no local-machine fallback identity to grant.

Every caller is resolved to an account by the auth provider before the permission decision runs (see `CONTEXT.md`). This project's own provider is a fixed whitelist of credential-to-account mappings, standing in for the "complex, high-security service" a real deployment would use — swapping it later changes nothing downstream, since the permission decision only ever sees the resolved account. There is no in-app account-creation mutation; an account exists because the whitelist says so.

Adding a tile mapper is allowed to anyone, even though the store it lands in is shared: someone who cannot add one cannot make their own query render. A mapper others reference has no single owner, so changing or deleting one falls back to the level, and deleting one still in use fails rather than cascading.

Blocking an integration stops new connections and refreshes while keeping everything stored, and tells affected users. Forced removal destroys credentials and leaves private queries unavailable rather than deleted.

## Persistence

Dashboard configuration, the tile pool, queries, and accounts are files on disk. No database — the dataset is small, and plain files stay readable by local tools.

Concurrent writes should not leave a half-written file. Write-and-rename is enough; a stricter transaction model is not required.

## Repository shape

One package, npm, no workspaces. One `components.json`, at the project root, project-owned and identical for everyone.

`shadcn add` decides where a file lands: base components to the UI alias, everything else to the components alias. Those are separate targets in a single package, so nothing about placement is a decision a model makes.

The whole base library is installed, not added component by component as a tile happens to need one. An agent writing a tile can import any shadcn component and find it already there, so which components exist is never a question it has to ask, and never an install step it could get wrong or skip. That is the same reasoning as everything else here: a decision a model does not have to make is variance it cannot introduce. The cost is a larger stylesheet, since Tailwind emits utilities for every installed component file whether a tile uses it or not; the JavaScript bundle is unaffected, because unused components are never imported.

Import paths stay in shadcn's most common form. That is deliberate — a path shape models have seen everywhere is one they reproduce consistently, and consistency between models is the product.

Appearance settings live in that one file and are project-level. A person's own appearance is served as a theme item instead, never written into configuration.

The dashboard registers its own registry in the same `components.json`, so an agent discovers tiles through the commands it already uses for everything else.

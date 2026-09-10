# Vocabulary

Terms this project defines, and what each one means. Nothing else defines these.

## What this file does not define

Everything below is shadcn's, and shadcn's documentation is the only source for it. This project uses these terms and never restates them:

registry, registry item and its types, `registry.json`, `registry-item.json`, `shadcn build`, namespaces, registry authentication, `components.json` and every field in it, style, base colour, theme, chart colour, preset codes, typeset, icon library, RTL, dark mode, the CLI, and the MCP server.

Where a term appears both here and there, shadcn's meaning wins. A definition of one of those terms appearing anywhere in this repository is a defect to delete, not a second opinion.

## Dashboard

An ordered set of tile references.

A dashboard holds no tile contents of its own — tiles live in one pool that the dashboard references into. Each reference carries which tile, its order, and its size.

Size is `sm`, `md`, or `lg`. Three values, because "make it wider" has one answer at three and twelve answers at twelve. Nothing else about placement is expressible.

## Tile

One placed thing on a dashboard: an id, a title, the registry item that renders it, and its state.

The registry item a tile names carries a JSON Schema in its `meta`, describing the data that item displays. The component's props type is derived from that schema, so the two cannot disagree — an item declaring data its component does not read fails to typecheck. A tile's state always fits the schema. Rendering is a straight read with no transform.

A tile carries no query, no credential, no appearance, and no placement of its own — where it sits and how wide belong to the dashboard that references it. One registry item backs any number of tiles. Retitling a tile or changing its state never changes the registry item.

## Display-role key

A key in a registry item's schema. Display-role keys name **how a value is displayed**, not what it means in an external domain: `COL_HEADER`, `LIST_ITEMS`, and so on.

This is what lets external data reach a tile without new code — a tile mapper maps incoming fields onto display-role keys. A schema may be empty, for an item that takes no input data.

## Query

A request made against an integration, paired with the tile mapper that reshapes the result. A query names the integration, what to run against it, and the mapper.

A query is user-specific: it runs under the credential of the user who supplied it, and is stored with that user rather than on a tile. One tile can be fed by several users at once.

Two queries against the same integration run separately and hold their own copy of the result. Nothing about a query is deduplicated or pooled.

## Tile mapper

The mapping from a structured data source's shape onto a registry item's display-role keys. Named for where it maps _to_, because what it maps _from_ is any structured data, not only an API response.

A tile mapper runs on the way in, before the result is stored, never at render time. It is deterministic: same input, same output, no IO, nothing read from outside its input.

A mapper is `"identity"` when the result already fits the schema, and otherwise an ordinary function typed against the schema — the same typecheck that gates a registry item's source gates its mappers. There is no mapping language to learn.

Not a formatter. A formatter changes data before it reaches a tile and decides something about its meaning. A mapper only restates a shape.

## Mutation

A named change applied against current state — "mark this task complete" — rather than a snapshot of the state the caller last saw.

## Dashboard configuration

The persistent part of a dashboard: its tiles, its ordered references, the integration list, and the tile mapper store, plus project policy.

Roles are not in it. Appearance is not in it. Credentials are not in it.

## Integration

A shared interface to an external service, defined once. An integration exposes queries that tiles draw from, and may also serve as a backup target.

Integrations are listed project-wide in dashboard configuration. An entry says how the integration is identified, whether it is default, recommended, or dynamically added, and whether it is available or blocked. Default and recommended entries persist; an unused dynamic entry expires after the retention period in project policy.

## Connection

One user's authorization to one integration. It holds a reference to that user's credential, never the credential itself, and no part of the shared integration definition.

Credentials are referenced by name in `${NAME}` form, following shadcn's registry-authentication convention. Resolution takes the name **and the acting account**, since one dashboard holds many people's credentials for the same integration and a name alone cannot tell them apart.

The value behind a name comes from an encrypted source, and rotation belongs to that source. The name never changes, and no secret crosses the interface — a caller passes a name and gets a request made on its behalf.

## Role

A named bundle of permissions, assigned to an account. A role carries no credential.

Access is governed in four categories — `data`, `tiles`, `integrations`, `roles` — each holding `noAccess`, `read`, `edit`, or `write`, ranked so each level implies the ones below it. `edit` changes something that already exists; `write` also creates and destroys.

One decision covers every request, taking the mutation's type, the acting account, and the target's owner. Something owned by the acting account needs no level, which falls out of that decision rather than sitting beside it as an exception.

Roles live in a file the source imports, not in dashboard configuration. Configuring them takes the same access as editing source code. No mutation reaches a role.

## Account

The identity a caller presents. An account holds a credential reference and the name of the role assigned to it, and lives outside dashboard configuration.

## Project policy

Project-wide lifecycle settings, each governed by the permission category for the thing it controls — for example, how long an unused integration entry is retained before removal.

## Settings

The screen through which a person manages their connections and their own appearance, without involving an agent.

Managing an integration here means connecting or disconnecting it — granting and revoking this dashboard's authorization to use a service. What a tile draws from that service is a query, not a setting on the connection.

Roles are not edited here.

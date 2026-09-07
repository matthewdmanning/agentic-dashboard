# Vocabulary

Terms this project uses, and what each one means. Nothing else defines these; if you find a term defined elsewhere, that is a bug to fix rather than a second opinion.

## Dashboard

An arrangement or ordering of cards on a page or display.

Concretely, a dashboard is a document: an ordered set of card references plus a theme reference. It holds no card contents of its own — a card lives in one pool that the dashboard references into.

## Card template

The reusable unit: a registry item whose component is paired with a JSON schema describing the input data that component displays. The component can render any data that fits the schema.

Every card template is a registry item, and a registry item is how one travels — added, served, and installed the way any shadcn item is.

A card template is whole-widget in grain — a calendar, an Eisenhower plot, a weather widget — not a layout atom. Card templates compose into other card templates.

A card template displays data that already fits its schema, and nothing more. It does not extract, remove, or reshape data.

## Registry item

shadcn's unit of distribution, and this project's too: a named JSON item carrying a `type`, the `files` it installs, and what it needs — `dependencies`, `registryDependencies`, and optionally `cssVars` and `css`. A registry serves items; `shadcn add` installs one. The schema is at <https://ui.shadcn.com/schema/registry-item.json>.

A card template is one. So is anything else a composition needs to arrive with: `registry:component` and `registry:ui` for components, `registry:hook` for a hook, `registry:lib` for a utility module, `registry:theme` and `registry:style` for presentation, `cssVars` and `css` for tokens and stylesheet rules. An item can carry several files of different types at once, so a card template that needs a hook and a stylesheet ships them in the same item rather than as loose instructions.

This is not a shape this project invented, and its vocabulary is shadcn's. Where a question about an item's fields is not answered here, the schema above answers it.

## Display-role key

A key in a card template's schema. Display-role keys name **how a value is displayed**, not what it means in an external domain: `COL_HEADER`, `LIST_ITEMS`, and so on.

This is what lets external data reach a template without new code — a card mapper maps incoming fields onto display-role keys. A card template's schema may be empty, for a template that takes no input data.

## Card

A card template in use: an id, a title, a reference to a card template, and its state. A card carries no queries — those are stored with the user who supplied them.

A card carries no position, no size, and no theme of its own. Placement belongs to the dashboard that references it, and appearance belongs to the theme that dashboard names. Retitling a card or editing its state changes the card, never the card template. One card template backs any number of cards.

## State

The data a card currently displays, stored already fitting its card template's schema. Rendering is a straight read with no transform.

State is changed by mutations, whatever produced them — a user edit or a query result reshaped by its card mapper. A card accepts manual edits to its state whether or not a query also writes it.

## Query

A request made against an integration, paired with the card mapper that reshapes the result. A query names the integration, the query to run against it, and the card mapper it maps the result through.

A query is user-specific: it runs under the auth token of the user who supplied it, and it is stored with that user's data rather than on a card. One card can still be fed by several users at once.

Two queries against the same calendar each run separately and hold their own copy of the result — nothing about a query is deduplicated or pooled.

## Card mapper

The mapping from a structured data source's shape onto a card template's display-role keys. Named `cardMapper` in code, after where it maps _to_ — a card — because what it maps _from_ is any structured data, not only an API response.

A card mapper runs on the way in, before the result is stored as state, never at render time. It is deterministic: same input, same output, no IO, nothing read from outside its input. It is `"identity"` when the result already matches the schema, a fixed function bundled with the application shell, or a declarative mapping spec — field renaming, fallback chains, defaults, and array mapping.

Not to be confused with a formatter, which is business logic that changes data _before_ it reaches a card. A card mapper only restates a shape; it does not decide anything about the data's meaning.

## Mutation

A named change applied against current state — "mark this task complete" — rather than a snapshot of the state the caller last saw.

## Dashboard configuration

The persistent part of a dashboard — what remains when the data flowing through
it changes. It holds cards, the dashboard, themes, the card mapper store, and
project policy. The integration catalog has its own file-backed store. Roles
live in a roles file the source imports. User appearance and connection
credentials are not dashboard configuration.

## Integration catalog

The project-wide, file-backed list of integration interfaces users may connect
to. An entry says how the integration is identified, whether it is default,
recommended, or dynamically added, and whether it is available or blocked.

## Integration

A shared interface to an external service, defined once in the integration
catalog. An integration exposes queries that cards draw from, and may also serve
as a backup target.

## Connection

One user's authorization to one integration. It owns that user's encrypted
credential and no shared integration definition.

## Theme

A named set of presentational settings applied to UI components. A theme cannot execute code, read dashboard data, or alter behavior.

A theme is the shared presentation a dashboard names. User-owned appearance
modifies it through base colour, typeset, `menuColor`, `menuAccent`, and
personal presets, all within the component library's vocabulary.

Theme definitions live in dashboard configuration; a dashboard references one. A theme's settings are a selection within the dashboard's component library, never arbitrary CSS.

## Component library

The fixed set of presentational components and CSS a dashboard is built from — shadcn/ui, with Tailwind CSS as its theming framework. Declared once, when the dashboard is initialized. No mutation changes it: changing it is a source change.

A theme can only set values the declared library defines. A card template composes that library's components directly — there is no separate structural layer underneath it. Where this project states no default of its own, shadcn/ui's default is the default.

## Base color

A modifier of a theme. It controls the default token values generated for the project at initialization or when a preset is applied.

Persistent and per-user: the same card showing the same data renders in different base colours for different users, so base colour belongs to who is looking rather than to the card, the dashboard, or the data.

## Preset

A whole colour token set, in the format of `globals-example.css` — the `@theme inline` mapping, `:root` and `.dark` blocks defining every token as an `oklch(...)` value, and the `@layer base` rules. Not a partial override.

## Per-user configuration

The preferences that belong to one user rather than to the dashboard: base
colour, typeset, `menuColor`, `menuAccent`, personal presets, and which preset
is selected. They live in a file-backed appearance store holding one record
per user, outside dashboard configuration and outside the credential store.

A user owns appearance, expressed in the component library's own semantics — never in CSS. The server owns data and card templates; a user's appearance settings do not reach either.

Secrets never live there.

## Role

A named bundle of permissions, assigned to an account. A role carries no credential. Roles live in a roles file the source imports, not in dashboard configuration: configuring them means editing that file, which takes the same access as editing source code. No mutation reaches a role.

## Account

The identity a caller presents. An account holds a credential and the name of the role assigned to it, and lives in the auth store, outside dashboard data.

## Project policy

Project-wide lifecycle settings governed by the permission category for the
thing they control — for example, how long an unused integration catalog entry
is retained before removal.

## Settings

The interface through which a user directly manages connections, themes, and
their own appearance — base colour, typeset, menu colour, menu accent, and
personal presets — without involving an agent. Roles are not edited here: they
live in a file the source imports.

Settings is a human screen. Managing an integration here means connecting or disconnecting it — granting and revoking this dashboard's authorization to use a service. What a card draws from that service is its query, not a setting on the connection.

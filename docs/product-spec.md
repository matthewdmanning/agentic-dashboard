# Dashboard — Product Specification

## Status

**Lowest authority in the repo.** This is the founding draft, written before
the shadcn/ui rewrite and the permission-matrix decisions. It was never
maintained through those changes and is known to contradict at least the
current permissions model (it describes Settings as changing agent
permissions; that is no longer true). Where this document conflicts with
anything else — code, `CONTEXT.md`, `ARCHITECTURE.md`, or any decision — the
other source wins, without exception. Treat this file as historical context
for the product's original goals, not as a current requirement, and verify
anything load-bearing against the real thing before relying on it.

**Its vocabulary is retired.** This document says "card", "card template",
"font scaling", and "agent permissions configured in Settings". None of those
are project terms any more — see `CONTEXT.md`, and `REBUILD-NOTES.md` for the
renames. Read the goals here; take no word from here.

Draft product specification: what the product must do. Items without a decision are explicitly marked **Open**.

This document does not describe how the product is built, and does not define terms. See [`ARCHITECTURE.md`](../ARCHITECTURE.md) and [`CONTEXT.md`](../CONTEXT.md).

## Product

A general dashboard for viewing and managing the user's chosen information and actions. It is not limited to job searches, study plans, or any other specific task domain.

The product is a one-page local web app whose application package is ready to run in a deployment environment. It does not have a separate landing or focus page. Building or provisioning cloud infrastructure is out of scope.

## Goals

- Help the user prioritize and focus on the actions and information most relevant now.
- Persist user changes durably, across sessions and browser restarts.
- Keep the dashboard usable locally without requiring network access.
- Keep content available in a form local AI tools can use as context.
- Allow optional connections to external services and optional cloud storage.
- Support included and third-party themes.
- Allow agents to create or change cards — their appearance, the data they accept, and their arrangement — in response to user prompts.
- Allow interaction with AI agents through dashboard state-management tools.

## First-release completion boundary

The first release is not complete until it includes all of the following:

- Local persistence, durable across sessions and browser restarts.
- Agent-created or agent-changed cards, each defining the shape of data it accepts.
- Persistent dashboard configuration for integrations, the selected UI theme, font scaling, agent permissions, cards, and arrangement.
- A Settings interface for directly managing integrations, themes, font scaling, and agent permissions without an agent.
- Agent interaction governed by permissions configured in Settings.
- Agentic tools for inspecting and updating dashboard state.
- A pull-only third-party integration with locally retained data.
- Encrypted third-party backup and restore.
- Included and third-party themes that work offline after installation.
- A deployment-ready application package that does not require cloud infrastructure or provisioning work to be part of this product.
- Authentication when the dashboard is externally accessible; local-only access does not require authentication.

These capabilities may be built sequentially.

## Local data and backend

- Dashboard content and settings persist locally.
- A database is out of scope because the product is too small to need one.
- The dashboard remains usable from its locally persisted state when external services or network access are unavailable.
- Locally persisted dashboard data remains directly usable as context for local AI tools.

## Access security

- Local-only dashboard access does not require authentication.
- The dashboard must require authentication when it is externally accessible.
- The exact authentication mechanism and external-access configuration remain open.

## Dashboard configuration and Settings

- Settings is the sole interface for adding, changing, and removing external-service integrations.
- Settings is the sole interface for adding, changing, removing, and selecting themes.
- Settings is the sole interface for changing font scaling.
- Settings is the interface for changing agent permissions.
- Card creation, card data mapping, and card arrangement happen through the agent interaction path, not Settings.
- Settings changes persist through the dashboard-configuration persistence interface.
- Credentials and tokens are not stored in dashboard data.
- Whether Settings may change authentication configuration remains open.

## Cards and data

- Data entering a card, from any source, conforms to that card's schema.
- Project-level preview of that mapping's output is out of scope.

## Agent interaction

- The product offers an option to interact with AI agents.
- The project includes agentic tools for inspecting and updating dashboard state.
- Agent access to dashboard state is governed by permissions configured in Settings.
- An agent session may be multi-step: the agent can ask follow-up questions before changing the dashboard.
- Any agent action that changes a connected third-party service requires explicit user approval before it is applied.
- Local AI tools are supported as an intended use case; cloud AI is optional.

## User experience

- The interface must feel pleasing and calming rather than dense or demanding.
- The visual hierarchy must draw attention to current action items and relevant information.
- Prioritization and focus are core product outcomes, not presentation-only enhancements.
- The dashboard is one page; prioritization happens within the dashboard rather than on a separate landing or focus page.
- Default components, included themes, and dashboard functionality must provide ways to emphasize high-impact items and reduce visual clutter.
- Cards and themes must be able to preserve a clear distinction between important items and supporting information.
- The primary interaction modes are tablet touch and mouse input.
- Interactive targets, gestures, menus, selection, reordering, and editing must work with both touch and mouse.
- Keyboard and assistive-technology access remain required accessibility basics.
- Detailed interaction, layout, visual, responsive, and accessibility requirements remain open.

## External-service integrations

- External services are optional, user-authorized pull sources.
- The dashboard retains the last successfully synced data locally.
- A failed or unavailable sync does not prevent use of other dashboard features.
- First-release integrations are pull-only: they do not create, edit, or delete data in the external service.

## Themes

- Included and third-party themes are supported.
- A UI theme is a set of presentational settings applied to UI components.
- Theme settings may specify color, typography, spacing, density, and high-impact treatments.
- A theme does not own or control dashboard presentation or behavior.
- Theme settings cannot execute code, access dashboard data, or alter prioritization behavior.
- Installed themes are stored locally and work offline after installation.
- An online catalog may be used to discover and install additional themes.

## Optional cloud backup and restore

- The app may back up both settings and content to optional cloud storage and restore them later.
- The dashboard does not require a cloud backup to operate.
- The cloud backup target is user-defined rather than a fixed repository or provider.
- Additional storage targets are planned for a later release.
- Uploaded dashboard data must be encrypted.
- First-release cloud storage does not synchronize edits between devices or reconcile concurrent changes.

## Existing implementation reference

The current static HTML dashboard and its JSON input are reference material for the new product, not the product scope itself:

Set `DASHBOARD_REFERENCE_DIR` to the directory containing the current references and `DASHBOARD_PROTOTYPE_DIR` to the directory containing the prototype.

- Current HTML reference: `${DASHBOARD_REFERENCE_DIR}/job-search-progress.html`
- Current JSON reference: `${DASHBOARD_REFERENCE_DIR}/study-plans.json`
- Interface prototype: `${DASHBOARD_PROTOTYPE_DIR}/personal-dashboard.html`

The existing template's study-plan, calendar, and focus data shapes are specific to that template and do not constrain the product architecture.

## Open decisions

- The exact local backend implementation and API.
- The persistence structure for dashboard data, settings, and backup metadata.
- The exact value models and precedence rules for impact, urgency, and completion.
- The encryption method, key ownership, recovery, and decryption behavior for cloud copies.
- Cloud backup creation, retention, restoration, and overwrite behavior.
- The MCP transport and lifecycle.
- The authentication mechanism and external-access configuration.
- Whether Settings may change authentication configuration.
- Deployment packaging, runtime configuration, and production-readiness acceptance criteria.
- Third-party theme discovery, review, installation, and removal behavior.
- The detailed interface and accessibility requirements beyond the prototype.

## Explicitly deferred

- Additional third-party integrations beyond the first.
- External-service write-back.
- A database.
- Cloud infrastructure and provisioning.

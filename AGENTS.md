# Agent Router

What you need, and where it lives. This file routes; it does not restate. Where a fact has a real source — `package.json`, the git log, the filesystem — go there rather than trusting a copy.

**All relevant docs must be committed in the same commit as their corresponding source code / config changes.**

## Read before working

| You need                                                          | Read                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| What was decided when planning — authoritative, ahead of the code | [`agent-docs/architecture-decisions.md`](agent-docs/architecture-decisions.md) |
| What a term means                                                 | [`CONTEXT.md`](CONTEXT.md)                                                     |
| How the app is built, and where a concern lives                   | [`ARCHITECTURE.md`](ARCHITECTURE.md)                                           |
| Why a choice was made                                             | [`docs/agents/rationale.json`](docs/agents/rationale.json), keyed by term      |
| How to write code here                                            | [`docs/agents/conventions.md`](docs/agents/conventions.md)                     |
| The MCP tool surface                                              | [`docs/agents/mcp.md`](docs/agents/mcp.md)                                     |
| How Github issues are tracked                                     | [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md)                 |
| shadcn/ui documentation — index of every page, for lookup         | <https://ui.shadcn.com/llms.txt>                                               |
| How `components.json` works, field by field                       | <https://ui.shadcn.com/docs/components-json>                                   |
| Available commands                                                | `package.json` scripts                                                         |
| Commit message style                                              | Conventional Commits; see `git log`                                            |

## How to respond

- End a long response with a summary in bullet points. Plain language, no implementation detail, 1-2 lines per item.
- Size each bullet by severity and how load-bearing it is. A minor item gets a clause; something severe, or something later work will rest on, gets the length needed to act on it without reading back up.
- Concise, but sufficient to decide from. Uniform-length bullets flatten the signal — a formatting nit should not read the same weight as a security decision.

## Non-negotiables

- Never commit credentials, tokens, personal content, real dashboard data, or sensitive field names or values. Fixtures are placeholder-only.
- Keep the dashboard general-purpose. Job-search and study data are examples, never domain concepts.
- Do not derive current requirements from material marked legacy, quarantined, superseded, archived, or backup.

## When documents disagree

Each fact has exactly one home. Two documents stating the same fact is a bug — fix it by deleting one, not by deciding which wins.

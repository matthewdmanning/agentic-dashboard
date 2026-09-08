# Agent Router

What you need, and where it lives. This file routes; it does not restate. Where a fact has a real source — `package.json`, the git log, the filesystem — go there rather than trusting a copy.

**All relevant docs must be committed in the same commit as their corresponding source code / config changes.**

## Read before working

| You need                                                                                                             | Read                                                                      |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| What a term means in context of project                                                                              | [`CONTEXT.md`](CONTEXT.md)                                                |
| How the app is built, and where a concern lives                                                                      | [`ARCHITECTURE.md`](ARCHITECTURE.md)                                      |
| The MCP tool surface                                                                                                 | [`docs/agents/mcp.md`](docs/agents/mcp.md)                                |
| shadcn/ui documentation — index of every page, for lookup                                                            | <https://ui.shadcn.com/llms.txt>                                          |
| How `components.json` works, field by field                                                                          | <https://ui.shadcn.com/docs/components-json>                              |
| Available script commands                                                                                            | `package.json` scripts                                                    |
| Git commit message style                                                                                             | Conventional Commits; see `git log`                                       |
| What was decided, and why -- ahead of the code                                                                       | [`docs/agents/rationale.json`](docs/agents/rationale.json), by id or term |
| Notes left by a previous session, not yet promoted anywhere durable                                                  | [`.handoff/`](.handoff/) — see rules below                                |
| Original product goals — lowest authority in the repo, unmaintained since the shadcn rewrite, verify before trusting | [`docs/product-spec.md`](docs/product-spec.md)                            |

## Handoff notes

`.handoff/` holds scratch context for whoever picks up next — not a source of
truth, not routed to for facts about the project.

- Filename starts with a `YYYY-MM-DD` prefix.
- Commit these files. Never push them to the remote.
- Delete the file once its task is complete. Don't leave a log.

## How to respond

- End a long response with a summary in bullet points. Plain language, no implementation detail, 1-2 lines per item.
- Size each bullet by severity and how load-bearing it is. A minor item gets a clause; something severe, or something later work will rest on, gets the length needed to act on it without reading back up.
- Concise, but sufficient to decide from. Uniform-length bullets flatten the signal — a formatting nit should not read the same weight as a security decision.

## Non-negotiables

- Never commit credentials, tokens, personal content, or sensitive field names or values. Fixtures are placeholder-only.
- Do not derive current requirements or criteria from material marked legacy, quarantined, superseded, archived, or backup.

## When documents disagree

Each fact has exactly one home. Two documents stating the same fact is a bug — raise the issue if discovered.

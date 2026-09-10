# Agent Router

What you need, and where it lives. This file routes; it does not restate. Where a fact has a real source — `package.json`, the git log, the filesystem — go there rather than trusting a copy.

**All relevant docs must be committed in the same commit as their corresponding source code / config changes.**

## Read before working

| You need                                                                                                             | Read                                                                                  |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| What a term means in context of project                                                                              | [`CONTEXT.md`](CONTEXT.md)                                                            |
| What the application does, and what is deferred to shadcn                                                            | [`ARCHITECTURE.md`](ARCHITECTURE.md)                                                  |
| What is being rebuilt, in what order, and when it is done                                                            | [`SHADCN_REWRITE_PLAN.md`](SHADCN_REWRITE_PLAN.md)                                    |
| What the old code called things, and corrections not to revert                                                       | [`REBUILD-NOTES.md`](REBUILD-NOTES.md) — temporary, delete after Phase 2              |
| The MCP tool surface                                                                                                 | Does not exist yet. Phase 2 builds it; see the plan. Do not infer it from `src/mcp/`. |
| shadcn/ui documentation — index of every page, for lookup                                                            | <https://ui.shadcn.com/llms.txt>                                                      |
| How `components.json` works, field by field                                                                          | <https://ui.shadcn.com/docs/components-json>                                          |
| Available script commands                                                                                            | `package.json` scripts                                                                |
| Agent skills this repo pins, and how to install them on a fresh clone                                                | [`skills-lock.json`](skills-lock.json); run `npm run skills:install`                  |
| Git commit message style                                                                                             | Conventional Commits; see `git log`                                                   |
| Why something was decided, and what was rejected — explains, does not bind                                           | [`docs/agents/rationale.json`](docs/agents/rationale.json), by id or term             |
| Notes left by a previous session, not yet promoted anywhere durable                                                  | [`.handoff/`](.handoff/) — see rules below                                            |
| Original product goals — lowest authority in the repo, unmaintained since the shadcn rewrite, verify before trusting | [`docs/product-spec.md`](docs/product-spec.md)                                        |

## Handoff notes

`.handoff/` holds scratch context for whoever picks up next — not a source of
truth, not routed to for facts about the project.

- Filename starts with a `YYYY-MM-DD` prefix.
- Commit these files. They are tracked, so a branch push carries them — keep them short-lived rather than assuming they stay local.
- Delete the file once its task is complete, or once what it describes is superseded. Don't leave a log.

## How to respond

- End a long response with a summary in bullet points. Plain language, no implementation detail, 1-2 lines per item.
- Size each bullet by severity and how load-bearing it is. A minor item gets a clause; something severe, or something later work will rest on, gets the length needed to act on it without reading back up.
- Concise, but sufficient to decide from. Uniform-length bullets flatten the signal — a formatting nit should not read the same weight as a security decision.

## Non-negotiables

- Never commit credentials, tokens, personal content, or sensitive field names or values. Fixtures are placeholder-only.
- Do not derive current requirements or criteria from material marked legacy, quarantined, superseded, archived, or backup.

## When documents disagree

Each fact has exactly one home. Two documents stating the same fact is a bug — raise the issue if discovered.

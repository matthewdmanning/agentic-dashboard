# Conventions

How to write code in this repository. Routed from [`AGENTS.md`](../../AGENTS.md).

## Vocabulary

Use terms exactly as [`CONTEXT.md`](../../CONTEXT.md) defines them, in code, tests, issue titles, and prose. Do not drift to synonyms the glossary avoids — a card template is not a "variant", a "definition", or a "kind".

If a concept you need is missing from the glossary, that is a signal: either the project does not use that language and you should reconsider, or there is a real gap worth naming.

## Style

TypeScript for application code. Presentational classes draw only from the declared component library's vocabulary (D23) — never arbitrary CSS.

`PascalCase` for React components, `camelCase` for functions and variables, kebab-case for documentation filenames. Prettier owns formatting — run `npm run format:check`.

## Testing

When coding a section governed by a contract, write its contract tests before implementing that section. Cover the interface functions and behaviors the contract promises, then implement code that passes them.

Every test must be load-bearing and represent a likely real use. Do not test errors that would already fail through the runtime, the compiler, or an existing caller path. Code without a contract is not subject to a blanket test-first rule.

Name colocated tests `*.test.ts` or `*.test.tsx`.

## Security

Never commit credentials, tokens, personal content, real dashboard data, or sensitive field names or values. Example fixtures contain placeholder data only — preserve a real shape by keeping its keys and nesting, never its content.

## Dependencies

Prefer a maintained library over a hand-rolled equivalent, but never add a dependency for what a few lines cover. Check whether a package is already present, directly or transitively, before declaring it.

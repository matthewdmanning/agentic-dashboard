# Rebuild notes

**Temporary. Delete this file when the rebuild is done.**

Everything here is about the codebase being replaced, not about the product being built. `CONTEXT.md` and `ARCHITECTURE.md` describe the project; this file exists only so an agent reading the old code is not misled by it.

Nothing in this file is a requirement. If it disagrees with the two specs, the specs win.

## Renames

| Old term                           | Now                                                             |
| ---------------------------------- | --------------------------------------------------------------- |
| card                               | **tile**                                                        |
| card template                      | nothing — a registry item, whose `meta` carries the data schema |
| card mapper                        | **tile mapper**                                                 |
| template (as a project noun)       | nothing — collided with the `--template` CLI flag               |
| presentation (permission category) | nothing — see below                                             |

## Vocabulary collisions to keep straight

The old code and its documentation used all of these interchangeably. They are not interchangeable.

- A **tile** is not shadcn's `Card`. `Card` is a component that a registry item's source may render into. A tile is a record this project stores and never installs. shadcn's own eval prompts say "stat cards in a grid" for what this project calls tiles, so the confusion is live in shadcn material too, not only in the old code.
- A **query** is not `shadcn search -q`. That searches registries. This requests data from an external service while the dashboard is running.
- shadcn writes "registry catalog" for a registry index. This project has no catalog. The old code called its integration list one.
- **Integrations resemble shadcn's `registries`** — a project-wide map of named external endpoints, each carrying credentials. They are not the same thing. A registry hands source code to a developer once, at author time; an integration hands data to the running dashboard repeatedly, per user. Building one as if it were the other is a defect.

## Terms deleted from the specification

The old `CONTEXT.md` defined all of these. shadcn defines them, so the project does not:

`registry item`, `theme`, `component library`, `base color`, `preset`, `per-user configuration`, `state`.

Deleting them was chosen over correcting them. A corrected duplicate is still a duplicate, and the old definitions were wrong on the details anyway — `--typeset-flow` was documented as CSS `text-wrap`, `--typeset-leading` as Tailwind's keyword scale, the base-colour list was missing four values and carried two that do not exist, and "preset" meant a whole CSS token file rather than shadcn's encoded config.

## Structures the old code built that shadcn already provides

| Old code                                                                                                             | Use instead                                                    |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `CardTemplateManifestEntry`, local `RegistryItem` interface                                                          | `registry-item.json`                                           |
| `activeCardTemplateManifest`, promoted `manifest.json`                                                               | `registry.json`                                                |
| `card-templates/build.ts` staging and promotion                                                                      | `shadcn build`                                                 |
| `buildRegistryIndex` / `buildRegistryItem`, dependencies derived by regex at request time                            | the built registry, served                                     |
| `server/appearance.ts` hand-copied palette, `presetTokens`                                                           | preset codes, `registry:theme` with `cssVars`                  |
| `AppearanceStore`, `appearanceCss`                                                                                   | a per-user theme item served from the dashboard's own registry |
| `CredentialStore`, `SecretBox`, encryption at rest, 90-day rotation, per-secret key naming, encrypted query envelope | `${NAME}` references resolved per acting account               |

The old code also hard-coded `type: "registry:block"` for single-file templates, which shadcn's own definition makes `registry:component`.

## Corrections to earlier conclusions — do not revert

- **`menuColor` and `menuAccent` are real shadcn fields.** An earlier session concluded they were invented and shipped commit `99d8307` on that basis. The CLI's own `info` output reports both as parsed config and both appear in `preset.values`. Context7's shadcn snapshot does not carry them and will suggest otherwise; it is stale on this point.
- **`"style": "base-nova"` is valid.** It is base (`base`) plus style (`nova`), and appears verbatim in the CLI reference. A fetch of `/docs/cli` claimed otherwise; that answer was incomplete.
- **Per-user content does not contradict shadcn.** `/docs/registry/authentication` documents user-personalized registries — authenticate the request, look up that user's preferences, serve a personalized item. Per-user appearance is a documented pattern, not a workaround, and it does not require a parallel appearance store.
- **`${VAR}` references resolve from environment variables.** The configuration holds a name, never a secret. Whatever populates the environment is unconstrained, so an encrypted source can sit behind it and rotate freely without the configuration changing. This is why none of the old credential apparatus has a job. The project resolves a name together with the acting account, since one dashboard holds many people's credentials for the same integration.
- **shadcn's auth examples are illustrations, not limits.** A single header set already carries two dimensions (`X-API-Key` plus `X-Workspace-Id`), header and parameter count is not fixed, and what the server resolves any of it to is the server's business. Multi-user needs no project-specific auth vocabulary.

## Permission categories

Five became four. `data`, `tiles`, `integrations`, `roles`.

`presentation` gated themes, base colour, typeset, presets, and menu colour and accent. All of those are now shadcn configuration or per-user registry content, so the category had nothing left to gate. Both default role bundles changed with it.

## Withdrawn decisions

`docs/agents/rationale.json` never reuses a number. These were withdrawn in the vocabulary rewrite, and their reasoning does not survive:

D5, D6, D7, D10, D12, D17, D22, D23, D25, D26, D27, D28, D33, D34, D36, D37, D39, D41, D42, D43, plus the standalone `@base-ui/react` note.

Of those, the ones an agent reading old code is most likely to trip on:

- **D22** specified assembling a component from a declarative composition tree (`{component, props, children}`). Withdrawn — a bespoke interface no model has seen maximises the variance the product exists to minimise. Models already write TSX against shadcn fluently. The typecheck gate it carried survives; the tree does not.
- **D39** specified a two-phase build with atomic promotion of a manifest and client assets. Withdrawn along with the manifest.
- **D26**/**D27** specified per-user appearance by scoping token values at runtime, on the belief that shadcn's mechanism was build-time only. Withdrawn — see the corrections above.
- **D28**/**D41**/**D42** specified the credential apparatus. Withdrawn — see the corrections above.

## What the old code could not do

Four independent breaks, any one of them sufficient. Named here because a reader may otherwise assume the old code worked and the rebuild is cosmetic. It did not; it could not produce a dashboard at all.

1. **No template discovery.** `add-card` required a template name plus state matching that template's schema. No tool let an agent learn either.
2. **`assemble-card-template` asked for a format with no reference.** It wanted a composition tree of components, and nothing told the agent what props any component accepted.
3. **Assembled templates never rendered.** The client rendered from a map compiled in at build time that nothing rebuilt from the promoted manifest.
4. **Layout was one-dimensional.** `insert-card` took only a card id and an index. Best possible output was a single-column stack.

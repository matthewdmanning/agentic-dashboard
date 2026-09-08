# Security follow-ups from the #90-#96 review

Two items found reviewing `9c71247..2966698`, deliberately left out of that
pass so they land as security changes rather than buried in a refactor. Neither
is a live failure today. Everything else from the review is fixed and committed
(`66978fb..c1bf89b`); the full record is
`docs/agents/review-2026-09-07-issues-90-96.md`.

Delete this file once both are done.

---

## 1. `blockedIntegrationNotices` decrypts credentials to answer an existence question

`src/service/index.ts:831`. To decide which blocked entries the caller is
connected to, it calls `connections.get(caller.user, integration.id)` once per
blocked entry and checks the result for `undefined`. `ConnectionStore.get` runs
AES-GCM `open`, so this decrypts a credential purely to learn whether a row
exists.

The stored envelope already carries `owner` and `catalogEntryId` in cleartext
(`src/server/integrations/connections.ts`, `storedConnectionSchema`) — the
answer needs no key at all. ARCHITECTURE.md calls `CredentialStore` "the single
seam every path goes through to reach a stored secret"; reaching through that
seam for something that is not a secret is the smell.

Second-order: one credential that fails to open (wrong key, corrupted record)
currently throws out of `Promise.all` and 500s the whole notices endpoint,
rather than that one entry being reported as not-connected.

**Fix shape.** Add an envelope-only reader to `ConnectionStore`:

```ts
/** The catalog entries one user holds a connection to — read from the cleartext envelope, never decrypting (D41). */
listEntryIdsForOwner(user: string): Promise<string[]>;
```

Implement it in `createEncryptedConnectionStore` as a filter over
`readConnections` — no `secretBox` call. Then `blockedIntegrationNotices`
becomes a set lookup, which also drops the current `Promise.all` +
filter-by-index shape:

```ts
const connected = new Set(
  await dependencies.connections.listEntryIdsForOwner(caller.user),
);
return integrations
  .filter((entry) => entry.state === "blocked" && connected.has(entry.id))
  .map(({ id }) => id);
```

**Blast radius.** Three in-memory fakes implement `ConnectionStore` and need
the new method: `src/mcp/server.test.ts:33`, `src/server/index.test.ts:41`,
`src/service/index.test.ts:53`. That cost is the only reason it was not done
in the review pass — it is mechanical, not risky.

**Worth a test.** That the notices path never calls `secretBox.open`: build a
store over a `SecretBox` whose `open` throws, give the caller a connection to a
blocked entry, and assert the notice still comes back. That pins the property
rather than the implementation.

---

## 2. `personalPresets` and `themeMapping` are unbounded and ungated

`src/contract/index.ts`:

- `:302` — `personalPresets: z.array(namedPresetSchema)`, no `.max()`.
- `:259` — `themeMapping: z.record(z.string().min(1), cssTokenValueSchema)`,
  unbounded key count and unbounded key length. Values are capped at 200
  characters by `cssTokenValueSchema` (`:191`); keys are not.

A user's appearance is theirs by structure (D35), so no permission gates a
write. That is correct and should stay — the gap is that nothing bounds the
size of what they can store.

Cost is not just disk. `createFileAppearanceStore.set`
(`src/server/appearance.ts`) reads every record and rewrites the whole file on
every write, so one user's oversized preset list is paid for on every other
user's appearance read and write.

**Reachability changed during the review.** Before, this was MCP-only. Commit
`e926bc0` added a Settings control that writes `personalPresets`, so the
browser reaches it too now. Still authenticated-only, still not a correctness
bug — but with more surface than when it was first written down.

**Not an injection vector today.** `themeMapping` keys are arbitrary strings
and never validated for shape, but nothing emits them: `tokenSetCss`
(`src/server/appearance.ts`) writes `light`, `dark`, and `radius` only, because
`styles.css` already compiles the mapping once (D27). If anything ever starts
emitting `themeMapping` into CSS, those keys become attacker-shaped and need
the same closed treatment `presetTokens` gets. Worth a comment at the schema so
that is not rediscovered the hard way.

**Decisions needed before coding — these are judgement calls, not lookups:**

- How many personal presets is a real user allowed? (Something like 50 is
  generous and still bounds the file.)
- How many `themeMapping` entries, and what maximum key length? The mapping
  mirrors `@theme inline` in `globals-example.css` — counting its entries gives
  a defensible ceiling rather than an invented one.
- Whether to bound the appearance record as a whole instead of field by field,
  which is fewer limits to keep in step but a worse error message.

Once chosen, the limits belong in `contract` so they are refused at the
boundary for every caller — HTTP, MCP, and Settings — not in any one of them.

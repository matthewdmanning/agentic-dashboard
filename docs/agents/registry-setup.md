---
scope: disaster-recovery
---

> Use this only to recreate the registry setup from scratch (e.g. after
> losing `registry.json`/`components.json`). For how the registry works
> day to day, see `ARCHITECTURE.md`.

# How to setup a registry

## 1. Define `registry.json` with `agentic-dashboard` and local registry-item paths

Declare items in `registry.json` using `agentic-dashboard` as the registry
name, mapping each `files.path` to `registry/`.

```json
{
  "$schema": "https://ui.shadcn.com/schema/registry.json",
  "name": "agentic-dashboard",
  "homepage": "http://localhost:3000",
  "items": [
    {
      "name": "custom-card",
      "type": "registry:block",
      "registryDependencies": [
        "https://base-registry.com/r/button.json",
        "@base/card"
      ],
      "files": [
        {
          "path": "registry/custom-card.tsx",
          "type": "registry:block"
        }
      ]
    }
  ]
}
```

## 2. Map registry-item aliases in `components.json`

Define the file path alias for registry items under `aliases`, and register
the local `@dashboard` namespace.

```json
{
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "utils": "@/lib/utils",
    "blocks": "@/registry"
  },
  "registries": {
    "@base": "https://base-registry.com/r/{name}.json",
    "@dashboard": "http://localhost:3000/r/{name}.json"
  }
}
```

## 3. Compile local static registry files

Run the `shadcn` build command to resolve local registry-item paths and
generate the static JSON endpoints (`npm run registry:build` wraps this —
see `package.json`).

```bash
npx shadcn@latest build
```

## 4. Install registry items using the `@dashboard` namespace

Add items to downstream local projects using the namespace CLI command.

```bash
npx shadcn@latest add @dashboard/custom-card
```

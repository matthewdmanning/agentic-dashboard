# How to setup a registry

## 1. Define `registry.json` with `PROJECT` and local block paths

Declare your items in `registry.json` using `PROJECT` as the registry name, mapping each `files.path` to your local blocks directory (e.g., `src/blocks/`).

```json
{
  "$schema": "https://ui.shadcn.com/schema/registry.json",
  "name": "PROJECT",
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
          "path": "src/blocks/custom-card.tsx",
          "type": "registry:block"
        }
      ]
    }
  ]
}
```

## 2. Map configurable block aliases in `components.json##`

Define the custom file path alias for your blocks under `aliases` and register the local `@PROJECT` namespace in the consumer project's `components.json`.

```json
{
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "utils": "@/lib/utils",
    "blocks": "@/src/blocks"
  },
  "registries": {
    "@base": "https://base-registry.com/r/{name}.json",
    "@PROJECT": "http://localhost:3000/r/{name}.json"
  }
}
```

## 3. Compile local static registry files

Run the `shadcn` build command to resolve your local block paths and generate the static JSON endpoints inside `public/r/`.

```bash
npx shadcn@latest build

```

## 4. Install block items using the `@PROJECT` namespace

Add items to downstream local projects using the namespace CLI command.

```bash
npx shadcn@latest add @PROJECT/custom-card

```

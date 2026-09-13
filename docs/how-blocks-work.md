# Are Blocks Just Compositions of Registry Items

**Yes, functionally and architecturally.** A block is a pre-assembled composition of primitive registry items, custom layout code, state logic, and npm packages.

However, under the hood of the `shadcn` CLI, a block differs from standard UI items in three specific ways:

---

## Key Operational Characteristics of Blocks

- **Automatic Dependency Resolution (`registryDependencies`):**
  When a block lists lower-level UI primitives in its manifest (e.g., `["button", "card", "input"]`), installing the block automatically triggers the `shadcn` CLI to download and configure those individual UI components in the target project if they don't already exist.
- **Directory Placement (`type: "registry:block"`):**
  Standard UI items (`registry:ui`) install by default into `@/components/ui/`. Blocks are treated as site sections or pages, so the CLI resolves their output path differently—typically copying files to custom feature folders (e.g., `@/components/blocks/` or `@/components/login-form/`) to avoid cluttering the atomic UI directory.
- **Multi-File Packaging:**
  While standard UI items are usually single files (e.g., `button.tsx`), blocks often consist of multiple files, including page wrappers, sub-components, custom hooks, and mock data setups bundled together in the registry item payload.

---

## How Blocks and Registry Items Compare

```
  ┌─────────────────────────────────────────────────────────────┐
  │ Block (registry:block)                                      │
  │ e.g., "dashboard-sidebar"                                   │
  │                                                             │
  │   Composed of:                                              │
  │   ├── Layout code & custom state hooks                      │
  │   ├── NPM deps: ["lucide-react", "recharts"]               │
  │   └── registryDependencies:                                 │
  │       ├── "button"     ─┐                                   │
  │       ├── "dropdown"   ├─► UI Primitives (registry:ui)    │
  │       └── "avatar"     ─┘                                   │
  └─────────────────────────────────────────────────────────────┘

```

---

### Example Manifest Comparison

**Standard Primitive (`registry:ui`):**

```json
{
  "name": "button",
  "type": "registry:ui",
  "dependencies": ["@radix-ui/react-slot"],
  "files": [{ "path": "ui/button.tsx", "type": "registry:ui" }]
}
```

**Composite Block (`registry:block`):**

```json
{
  "name": "login-01",
  "type": "registry:block",
  "dependencies": ["lucide-react"],
  "registryDependencies": ["button", "card", "input", "label"],
  "files": [{ "path": "blocks/login-01/page.tsx", "type": "registry:block" }]
}
```

When you run `npx shadcn@latest add login-01`, the CLI fetches the block's visual layout and recursively installs `button`, `card`, `input`, and `label` alongside it.

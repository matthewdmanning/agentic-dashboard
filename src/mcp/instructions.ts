import { dashboardOrigin, workspaceDirectory } from "../workspace";

const ORIGIN = dashboardOrigin();
const WORKSPACE = workspaceDirectory();

/** Sent on every MCP connection, including clients with no dashboard checkout. */
export const INSTRUCTIONS = `
This dashboard is an ordered set of tile references. A tile names a registry
item, carries state matching that item's meta.schema, and is placed at size
"sm", "md", or "lg". Two "md" tiles fill one row; one "lg" fills a row.

The dashboard registry is at ${ORIGIN}/r/registry.json. Discover existing
tile items and their required state keys on demand:
  npx shadcn@latest search ${ORIGIN}/r/registry.json
  npx shadcn@latest view ${ORIGIN}/r/<name>.json
Read meta.schema.required and meta.schema.properties before supplying state.

For component discovery and authoring, use the public shadcn Agent Skill at
https://skills.sh/shadcn/ui/shadcn and the shadcn MCP server documented at
https://ui.shadcn.com/docs/mcp. Run shadcn MCP with its working directory set
to the writable dashboard workspace so it reads that workspace's
components.json. Search all configured shadcn-compatible registries, including
the default shadcn registry; component descriptions are retrieved when needed.

Use an existing tile item if it fits. If you have source-authoring permission
and access to the writable workspace at ${WORKSPACE}, you may add a new item:
preview the chosen component with shadcn add --dry-run, reject any installation
target outside that workspace, install there, write registry/<name>.tsx and
its registry.json entry with meta.schema, run the installed app's typecheck and
registry:build commands with DASHBOARD_WORKSPACE set to that absolute path,
then place the tile through apply. Never write to the installed app or src/.
If you have only dashboard-state permission, choose an existing tile item and
use the two dashboard tools below; do not attempt source installation.

read-dashboard reads the current tiles and placements. apply atomically
changes dashboard state: add or remove a tile, set state or title, and place
or resize it. Source files and component installation are outside apply.

Every account acting through apply needs a level on the "data" category to
add, edit, or delete an entry inside a tile's state (an object in an
array-shaped state value, or the whole state for a tile with no array).
Editing or deleting an entry you do not own is refused unless your account
holds write on data; adding a new entry, reordering entries, and changing a
tile's placement never need ownership of anything, but still need a level on
data or tiles as above. Ownership only ever narrows which entries your level
reaches — it never grants an operation on its own, so an account with no
level on data is refused even for an entry it owns.

Mark a field as interactive by adding "interactive": true directly on that
field's own definition in meta.schema (e.g. a checklist item's CHECKED
property), not in a separate list. Changing only interactive-marked fields on
an entry is exempt from the ownership check above — any account with its
level on data may toggle it regardless of who owns the entry — but the level
itself is still required; the marker never exempts a level check, only
ownership.
`.trim();

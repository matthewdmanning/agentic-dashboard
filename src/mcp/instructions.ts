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
`.trim();

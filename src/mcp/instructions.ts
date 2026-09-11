// The dashboard server this MCP server belongs to reads the same PORT, so the
// address quoted below is the one actually being served rather than a constant
// that goes stale the first time a run moves off the default port.
const ORIGIN = `http://localhost:${process.env.PORT ?? 5173}`;

/**
 * Sent to every connecting client (see `McpServer`'s `instructions` option).
 * Written for an agent with no checkout of this repository, no shadcn Agent
 * Skill, and no prior context — everything it needs to name every available
 * tile and use these two tools correctly must be here or in the tool
 * descriptions, never in a document it would have to go find.
 */

export const INSTRUCTIONS = `
This server runs a dashboard: an ordered set of tile references. A tile is
one placed thing on the dashboard — an id, a title, the registry item that
renders it, and its state (the data that item displays). Placement — a
tile's position and size — belongs to the dashboard, not the tile. Size is
"sm", "md", or "lg": the grid is four columns wide, so two "md" tiles side
by side fill one row, one "lg" tile fills a row alone, and "sm" is a
quarter-row.

Available tiles are NOT listed by a tool here. They are discovered through
this dashboard's own shadcn registry, served at:

  ${ORIGIN}/r/registry.json

Both commands below take that URL directly and need no project, no
components.json, and no checkout of this repository:

  npx shadcn@latest search ${ORIGIN}/r/registry.json
      Lists every available tile, one item URL per line.

  npx shadcn@latest view ${ORIGIN}/r/<name>.json
      Prints one item in full, including its "meta.schema".

If you do have a project with a components.json, you may register the
namespace once and use the shorter forms instead:

  npx shadcn@latest registry add "@dashboard=${ORIGIN}/r/{name}.json"
  npx shadcn@latest search @dashboard
  npx shadcn@latest view @dashboard/<name>

Without a components.json, "registry add" fails — use the URL forms above.

Each registry item carries a JSON Schema at "meta.schema". That schema is
where a tile's required state keys come from: read "meta.schema.required"
(and "meta.schema.properties" for each key's type) to know what state a
tile of that item needs before adding it.

Two tools, nothing else:

  read-dashboard  Read the dashboard's current tiles and references.
  apply           Apply one or more mutations atomically and persist them.

Every change to the dashboard — adding, removing, or retitling a tile,
changing its state, or repositioning/resizing it — goes through "apply".
There is no other way to change anything.
`.trim();

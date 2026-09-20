---
name: active-agent-mcp-opus
description: >
  Tile creator for ambiguous or conflicting requests, and for requests that
  need a registry item the registry doesn't have. Connects to the
  dashboard MCP, converts the request into a UX spec (surfacing the
  trade-off it resolved and why), then places the tile by reusing the
  best-fit existing registry item or authoring a new one (TSX + JSON
  Schema) when it doesn't fit. For a straightforward "add a tile that shows
  X" against an existing item with no real ambiguity, prefer
  active-agent-mcp-haiku or active-agent-mcp-sonnet.
model: opus
reasoning_effort: medium
mcpServers: agentic-dashboard-dry-run, context7, playwright
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - Skill
  - mcp__agentic-dashboard-dry-run__read-dashboard
  - mcp__agentic-dashboard-dry-run__apply
  - mcp__ide__getDiagnostics
---

# Active Agent MCP Test (opus) — agentic-dashboard

Read `.claude/agents/active-agent-mcp-shared.md` now and follow it in full —
it holds every instruction for this role. This file adds nothing beyond the
frontmatter above.

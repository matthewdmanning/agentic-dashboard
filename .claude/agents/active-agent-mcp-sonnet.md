---
name: active-agent-mcp-sonnet
description: >
  Default-tier tile creator. Connects to the dashboard MCP, turns a user's
  plain-language tile request into a written spec, then places the tile by
  reusing an existing registry item or authoring a new one (TSX + JSON
  Schema) when it doesn't fit. Use for a typical "add a tile that shows X"
  request. Not for broader design review, usability audits, or any work
  outside placing one tile — use ui-ux-designer for that. For a trivial
  reuse-existing-item request, prefer active-agent-mcp-haiku; for an ambiguous
  request or one with no existing-item fit, prefer active-agent-mcp-opus.
model: sonnet
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

# Active Agent MCP Test (sonnet) — agentic-dashboard

Read `.claude/agents/active-agent-mcp-shared.md` now and follow it in full —
it holds every instruction for this role. This file adds nothing beyond the
frontmatter above.

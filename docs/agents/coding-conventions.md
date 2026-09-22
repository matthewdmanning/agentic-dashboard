# Coding conventions

Read this before you write or edit code in this repository.

This file holds only what has no other home. It does not restate the router.
For script commands read `package.json`. For commit message style read
`git log`. For the MCP tool surface read `src/mcp/instructions.ts`.

## Delegating coding work

- A coding subagent must be a **sonnet** model.
- Give a subagent three things: the file paths or links it needs, its
  instructions, and the success criteria it will be judged against.
- **Review a subagent's code before you commit it.** Read the diff. Do not
  commit work you have not read.
- Never spawn a general-purpose subagent unless the user's own message
  contains the exact phrase `general-purpose`.
- Name the files two subagents could both touch, and say which one owns each.
  A subagent that does not know about a clash will cause one.

## Stopping

Stop and ask when you are stuck or when the same failure repeats. Do not try
a third approach on a failing path. Report what fails and ask.

Propagate this rule to every subagent you start.

## Generated files

Never hand-edit a generated file. Change its source and regenerate. The
file's own header names the script that writes it.

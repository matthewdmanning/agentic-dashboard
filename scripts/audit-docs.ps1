# Runs the docs audit headless, using the locally-authenticated `claude` CLI
# (no ANTHROPIC_API_KEY needed). Invoked on a schedule by the "agentic-dashboard
# docs audit" Windows Scheduled Task; run it directly to test.

Set-Location (Split-Path $PSScriptRoot -Parent)

$prompt = @'
Audit every .md file in docs/ and memory/, plus AGENTS.md, ARCHITECTURE.md,
and CONTEXT.md. Do not edit anything. Check three things:

1. Staleness — a claim that no longer matches the current code on this
   branch.
2. Duplication — the same fact stated in two or more of these documents.
   Each fact has exactly one home; a second document stating it is a bug,
   not a cross-reference.
3. Scope drift — a document holding content outside its own stated
   purpose (e.g. a doc restating another doc's or shadcn's own vocabulary
   instead of routing to it).

For each finding, note: file(s), line number(s), the problem text, and the
corrected text (for staleness) or which document should keep the fact and
which should route to it instead (for duplication/scope drift).

If you find anything, open one GitHub issue with `gh issue create --title
"Docs audit: N finding(s)" --body "<markdown table of findings, with a
column for which check (staleness/duplication/scope) each one is>"`. Add
`--label documentation` if that label exists in this repo, otherwise omit
it. If you find nothing, do not open an issue.
'@

claude -p $prompt --model sonnet --effort medium --allowedTools "Read,Grep,Glob,Bash(git:*),Bash(gh label:*),Bash(gh issue:*)"

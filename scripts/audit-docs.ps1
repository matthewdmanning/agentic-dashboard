# Runs the docs audit headless, using the locally-authenticated `claude` CLI
# (no ANTHROPIC_API_KEY needed). Invoked on a schedule by the "agentic-dashboard
# docs audit" Windows Scheduled Task; run it directly to test.

Set-Location (Split-Path $PSScriptRoot -Parent)

$prompt = @'
Audit every .md file in docs/ and memory/, plus AGENTS.md, ARCHITECTURE.md,
and CONTEXT.md, against the current code on this branch. For each stale
claim, note: file, line number, the stale text, and the corrected text. Do
not edit anything.

If you find any stale claims, open one GitHub issue with `gh issue create
--title "Docs audit: N stale claim(s)" --body "<markdown table of
findings>"`. Add `--label documentation` if that label exists in this repo,
otherwise omit it. If you find nothing stale, do not open an issue.
'@

claude -p $prompt --model sonnet --effort medium --allowedTools "Read,Grep,Glob,Bash(git:*),Bash(gh label:*),Bash(gh issue:*)"

# Triage Labels

The skills speak in terms of five canonical triage roles. Labels are not required but can be used if you determine it will be helpful.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | **Don't use.**       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `question`           | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `help wanted`        | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Verified against `gh label list` on 2026-09-17. `needs-info`/`ready-for-human` have no exact-name label in this repo — `question`/`help wanted` are the closest semantic match. `needs-triage` has no equivalent at all; don't substitute one.

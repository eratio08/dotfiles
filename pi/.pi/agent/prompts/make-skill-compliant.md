---
description: Audit a skill for Agent Skills compliance and apply safe fixes after one approval
argument-hint: "[skill-path]"
---
Audit the skill at `${1:-.}` for Agent Skills compliance.
Treat `${1:-.}` as either a skill directory or a `SKILL.md` path, and resolve it to the skill root first.
Work only inside that skill directory.
Be Pi-lenient.
Do not require the `name` field to match the parent directory.
Do not use external validators or any non-self-contained dependency.

First inspect the skill and produce a dense audit with:
- resolved skill root path
- files inspected only when needed to explain a non-compliant item
- hard compliance violations only
- blocked or ambiguous items only when they prevent a safe fix
- exact safe fix plan
- no compliant-item summaries or other noise

Validate manually against these hard rules:
- the skill must contain `SKILL.md`
- `SKILL.md` must start with YAML frontmatter, followed by a Markdown body
- frontmatter must contain non-empty `name` and `description`
- `name` must be 1-64 characters and use only lowercase `a-z`, `0-9`, and `-`
- `name` must not start or end with `-`
- `name` must not contain consecutive `--`
- `description` must be 1-1024 characters
- if present, `compatibility` must be 1-500 characters
- if present, `metadata` must be a mapping/object
- if present, `allowed-tools` must be a space-separated string
- skill-local relative file references in skill Markdown must resolve from the referring file's actual location; a reference that treats a file as if it were in the skill root when it is actually in a subdirectory is a hard compliance violation
- unknown frontmatter fields may stay
- do not enforce directory-name matching

Then compute the smallest safe fix plan.
Safe fixes may include:
- creating minimal frontmatter if missing
- fixing an invalid or missing `name`
- fixing an invalid or missing `description`, preferring existing `SKILL.md` wording before inferring from files
- fixing invalid `compatibility`, `metadata`, or `allowed-tools`
- fixing incorrect skill-local relative file references when the intended target is unambiguous
- moving obvious root files into `references/`, `scripts/`, or `assets/`
- updating only skill-local references after such moves
- fixing cross-file references inside moved skill files when they point to other moved skill files

Use these move rules only when the destination is obvious:
- documentation `.md` files other than `SKILL.md` go to `references/`
- executable helpers or code clearly used as runnable helpers go to `scripts/`
- static templates or data/assets like `.json`, images, and similar non-executable resources go to `assets/`

If a destination is ambiguous, do not change it.
List it under blocked items with the exact manual decision needed.

Before making any edits or moves, stop and ask once for approval on the whole plan.
Do not ask per change.
After approval, apply only the safe fixes.
If some items remain blocked, still apply the safe fixes and then report the blocked items clearly.
Keep edits minimal.
Do not touch files outside the selected skill directory.

Use this response shape before approval:
- Violations
- Safe fix plan
- Blocked items
- One approval question

Use this response shape after approval:
- Changes made
- Remaining blocked items
- Final compliance status

If there are no violations and no blocked items, say so in one short line and ask whether to apply the no-op plan.

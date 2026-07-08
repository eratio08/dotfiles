---
name: create-jira-pr
description: Creates Jira-linked pull requests from completed code changes. Use when asked to "create a PR", "open a PR", "prepare a PR", "make a pull request", or "create Jira PR". Ensures repository history and pull request metadata follow project conventions.
---

# Create Jira PR

Create signed commits and open PR.

Use direct commands below.
Only run commands needed for current step.

## Step 1: Inspect State

Use commands below only when corresponding fact needed.

Use `git rev-parse --show-toplevel` to get repo root.
Need: run repo-scoped commands from correct directory.

Use `git branch --show-current` to get current branch.
Need: infer Jira key, check existing PR, push correct branch.

Use `git status --short` only to see whether worktree has staged or unstaged changes.
Need: decide whether commits still need to be created.

Use `git diff --name-only` only to list unstaged files.
Need: propose commit groups.

Use `git diff --cached --name-only` only to list staged files.
Need: propose commit groups and confirm what is ready to commit.

Use `git log --oneline -5` only to inspect recent commit titles.
Need: avoid duplicate commits and show user what will likely be pushed.

Use `git rev-parse --abbrev-ref --symbolic-full-name '@{u}'` only to detect upstream branch.
Need: decide between `git push` and `git push -u origin <branch>`.

Use `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'` only to get default base branch.
Need: choose PR base when no clearer base is known.

Use `gh pr list --head "$(git branch --show-current)" --state open --json url --jq '.[0].url'` only to detect existing open PR for current branch.
Need: stop before creating duplicate PR.

If current branch already has open PR, stop and ask user whether to update it or use different branch.

## Step 2: Resolve Jira Ticket

Infer Jira key from branch name first.
Use uppercase key plus number pattern such as `ABC-123`.
If missing or ambiguous, ask user.
Use same Jira key for every commit in this run unless user asks otherwise.

## Step 3: Propose Commit Groups

Group changes by behavior change.
Prefer one commit per logical change.
Before committing, show proposed groups and ask for approval.

Format:

```text
Proposed commit groups:
1. API validation fix in src/api/... and tests/...
2. PR template cleanup in .github/...
```

Do not create commits before approval.

## Step 4: Choose Gitmoji

Use literal emoji.

| Change type | Emoji |
| --- | --- |
| New feature | `✨` |
| Bug fix | `🐛` |
| Performance | `⚡️` |
| Refactor | `♻️` |
| Documentation | `📝` |
| Tests | `✅` |
| Build or CI | `👷` |
| Dependencies | `⬆️` |
| Configuration | `🔧` |
| Cleanup | `🔥` |

If unclear, ask user.
PR title emoji should summarize whole PR.

## Step 5: Create Commits

Create signed commits only.
Use `git commit -S`.
If signing fails, stop.

Commit title format:

```text
JIRA-123 ✨ Descriptive title
```

If commit has body, keep it short and explain why.

Stage only approved files.
Use `git diff --cached` right before commit.
Need: verify staged files match approved commit group.

Leave unrelated worktree changes untouched.
Never amend, rebase, or rewrite history unless user asks.

## Step 6: Draft PR

PR title format matches commit title format:

```text
JIRA-123 ✨ Descriptive title
```

PR body must be exactly:

```markdown
Jira: ABC-123

## WHY
Explain motivation for change.

## WHAT
Summarize implemented changes concisely.
```

Use full Jira URL only when user gives it or repo conventions make it obvious.
Otherwise use Jira key only.
Do not add extra sections.

## Step 7: Push And Create PR

If base branch ambiguous, ask user.
Otherwise use default branch or upstream base branch.

Before PR creation, show user:

1. Commit list to be pushed.
2. PR title.
3. PR body.

Ask for final approval if any part was inferred.

If branch has no upstream, push with:

```sh
git push -u origin "$(git branch --show-current)"
```

Otherwise push with:

```sh
git push
```

Create PR with `gh pr create` and `--body-file`.
Use stdin or file, not inline multi-line shell arg.

Example:

```sh
gh pr create --base "$base" --title "$title" --body-file - <<'EOF'
Jira: ABC-123

## WHY
...

## WHAT
...
EOF
```

Return PR URL.

## Final Response

Report in this order:

1. PR URL.
2. Commits created.
3. Warnings or unresolved assumptions.

## Stop Conditions

Stop and ask user if commit grouping is ambiguous.
Stop and ask user if Jira key is missing or ambiguous.
Stop and ask user if gitmoji choice is ambiguous.
Stop and report error if signed commit setup fails.

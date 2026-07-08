---
name: process-dependabot-prs
disable-model-invocation: true
description: Approve and merge safe Dependabot PRs.
---

# Dependabot PR Manager
Wrangle Dependabot PRs into `safe bump` decisions.
`safe bump` means dependency update can be approved without user handoff because version class and evidence satisfy explicit gates.
Checks decide merge readiness, not approval readiness.

## Workflow

### 1. Discover candidate PRs

Completion criterion: every open Dependabot PR in current GitHub review-requested inbox has been listed once.
Use `review-requested:@me` as primary source.
Filter to author `app/dependabot`.
Do not use GitHub assignee as ownership signal.
If review-requested search misses expected team requests, report that limitation instead of guessing team list.
```bash
gh search prs --state open --author app/dependabot --review-requested @me --limit 1000 --json number,title,url,repository,author
```

### 2. Inspect each PR

Completion criterion: each candidate PR has dependency list, old version, new version, current review decision, merge state, and check rollup.
```bash
gh pr view <number> --repo <owner/repo> --json title,body,headRefName,baseRefName,reviewDecision,mergeStateStatus,statusCheckRollup,reviews,url
```

### 3. Classify bump risk

Completion criterion: every dependency in every candidate PR has one class: `patch`, `minor`, `major`, or `handoff`.
SemVer patch and minor are safe candidates only when current major is `1` or greater.
Any `0.x` bump is `handoff`.
Any non-SemVer, calendar version, missing version, unknown version, or ambiguous version is `handoff`.
For multi-dependency PRs, aggregate by strictest result.
If any dependency is `handoff`, PR is `handoff`.
If any dependency is `major`, PR follows major-review path.
Only all-patch/all-minor PRs can skip changelog research.

### 4. Approve minor and patch safe bumps

Completion criterion: every all-patch/all-minor safe bump has been approved unless already approved by someone else.
Do not add custom approval body for minor or patch bumps unless GitHub requires body.
Failed, pending, missing, or unknown checks do not block approval.
If PR is already approved by someone else, do not merge automatically; hand off before merge.
```bash
gh pr review <number> --repo <owner/repo> --approve
```

### 5. Assess major bumps

Completion criterion: every major PR has one outcome: approved with evidence comment, or handed off.
Fetch authoritative changelog, release notes, package maintainer text, GitHub releases, package registry page, or repository changelog from Dependabot PR links.
Approve only when authoritative text explicitly says no breaking changes, no migration required, or fully backward compatible.
Dependabot generated summaries, compatibility score, or agent inference are not enough.
Failed, pending, missing, or unknown checks do not block approval when evidence gate passes.
Approval comment must state evidence tersely.
```bash
gh pr review <number> --repo <owner/repo> --approve --body "Approved: major bump; upstream release notes explicitly state no breaking changes."
```
If breaking changes, migration steps, removed APIs, compatibility uncertainty, or no explicit evidence exists, hand off with evidence summary.

### 6. Merge eligible PRs

Completion criterion: every approved-by-this-run PR is either merged, skipped because checks or merge state block it, or handed off because merge method is ambiguous.
Merge only PRs approved by this skill in current run.
Do not merge PRs approved before this run by another reviewer; hand off.
Every visible check/status must be passing, skipped, or neutral.
Pending, failing, cancelled, missing, or unknown checks block merge.
When checks fail, collect failed check names and URLs for final report.
Do not wait for pending checks.
Prefer squash merge if repository allows it.
If squash is blocked by repository policy, use enforced allowed method, preferring rebase then merge.
Do not bypass branch protection, force merge, admin-merge, or resolve conflicts.
```bash
gh pr merge <number> --repo <owner/repo> --squash --delete-branch
```
Fallback only when squash is disallowed by repository policy:
```bash
gh pr merge <number> --repo <owner/repo> --rebase --delete-branch
```
Last resort only when repository policy enforces merge commits:
```bash
gh pr merge <number> --repo <owner/repo> --merge --delete-branch
```

### 7. Report results

Completion criterion: final response lists every candidate PR under one outcome: approved, merged, skipped, or handoff.
For each PR, include direct PR URL.
For each skipped PR, include reason.
For each PR with failed checks, include failed check names and URLs.
For each handoff, include exact unresolved decision and evidence found.

## Safety Boundaries

Do not approve `handoff` bump classes.
Do not approve major bumps without authoritative explicit no-breaking-change evidence.
Do not merge unapproved PRs.
Do not merge PRs not approved during current skill run.
Do not merge with pending, failing, missing, cancelled, or unknown checks.
Do not let failed checks block approval of `safe bump`; they only block merge.
Do not edit dependency files, resolve conflicts, rerun CI, or push commits unless user explicitly asks.

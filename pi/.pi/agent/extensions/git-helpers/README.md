# Git helpers

This Pi extension adds commands for GitHub pull requests.
A pull request asks reviewers to merge a branch.

## Requirements

Install Git and GitHub CLI.
Authenticate GitHub CLI for the repository.
Make sure that a browser is available.

Run `bun install` in the `git-helpers` directory.
Build `../lib/pi-effect` if its `dist` directory does not exist.
Load `git-helpers/index.ts` in Pi and run `/reload`.

## Commands

- `/ghpr` pushes the current branch and creates a pull request.
- `/ghprd` pushes the current branch and creates a draft pull request.
- `/ghv` opens the pull request for the current branch.

The creation commands open the new pull request in the browser.
GitHub CLI uses commit messages for the title and description.
The commands push committed changes only.
The extension warns about uncommitted changes and does not stage or commit files.

An upstream is the remote branch that a local branch tracks.
If the current branch has an upstream, its branch name must match the local branch name.
If the current branch has no upstream, the repository must have exactly one remote.
The extension sets the upstream after the push.

The extension does not force-push.
If a pull request already exists, GitHub CLI reports it and does not create another one.
If the browser cannot open the new pull request, the extension reports its URL.

## Checks

Run `bun test tests/*.test.ts` in the `git-helpers` directory.
Run `bun run typecheck` in the `git-helpers` directory.
Run `bun run check` in the `git-helpers` directory.

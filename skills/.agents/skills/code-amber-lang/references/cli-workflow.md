# CLI Workflow

## Core Commands

Use `amber check file.ab` to validate syntax and typing before execution.
Use `amber run file.ab` to compile and run a script in one step.
Use `amber build input.ab output.sh` to produce distributable Bash.
Use `amber eval '...'` for quick experiments.
Use `amber test` to run Amber test blocks.
Use `amber docs file.ab` to generate Markdown documentation.

## Recommended Loop

Write or edit the `.ab` file.
Run `amber check` first.
Run `amber test` if tests exist.
Run `amber run` for behavioral verification.
Run `amber build` when the deliverable needs a Bash artifact.

## Shebang Use

Use `#!/usr/bin/env amber` when the script should be directly executable as Amber source.
Use `amber build` when the output should be plain Bash without an Amber dependency at execution time.

## Build Expectations

Treat the built file as normal Bash output.
Expect Amber to add the shebang and make the generated script executable.
Verify the generated script if portability or shell integration matters.

## When To Read More

Read `references/examples.md` when the task needs a larger project shape.
Read `references/bash-interop.md` when generated Bash behavior or shell semantics are part of the task.

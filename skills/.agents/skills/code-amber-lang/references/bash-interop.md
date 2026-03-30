# Bash Interop

## Core Idea

Amber is not a separate runtime target.
Amber compiles to Bash, so shell interop is a first-class part of the language.

## Commands Inside Amber

Use `$ ... $` for shell commands.
Treat command execution as something that still belongs inside Amber's safety rules.
Handle failures explicitly instead of assuming shell permissiveness.

## When To Prefer Amber

Prefer Amber functions, types, and control flow for orchestration logic.
Prefer stdlib imports when they express the intent more clearly than raw shell.
Prefer `main(args)` and typed helpers over large inline command chains.

## When To Prefer Raw Commands

Use raw commands when the task is naturally delegated to an external Unix tool.
Use raw commands when the shell command itself is the core behavior and wrapping it in extra abstractions would make the script less clear.

## Portability Notes

Remember that Amber targets Bash.
Be careful with shell-specific assumptions if the generated script must run across macOS Bash and GNU Bash environments.
Prefer straightforward commands and avoid relying on obscure shell behavior unless required.

## Sharp Edge

`trust` makes interop feel more like raw Bash.
Use it only intentionally.

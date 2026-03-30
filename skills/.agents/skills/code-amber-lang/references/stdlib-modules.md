# Stdlib Modules

## Import Model

Builtins do not require imports.
Stdlib helpers come from `"std/<module>"`.
Import only what the script uses.

## High-Value Modules

Use `std/text` for string helpers such as joining and text utilities.
Use `std/fs` for filesystem-oriented helpers before reaching for raw shell commands.
Use `std/env` for environment access.
Use `std/http` for HTTP-oriented helpers when the stable docs confirm the needed API.
Use `std/test` for assertions in Amber tests.

## Selection Guidance

Prefer stdlib helpers when they make the script clearer and preserve Amber's safety model.
Prefer raw commands when the task is inherently shell-oriented and the command itself is the clearest implementation.
Verify module APIs against the stable docs before using less common helpers because docs and repo examples may drift across versions.

## Common Patterns

Import a few named helpers when the usage surface is small.
Import the whole module only when many helpers from the same namespace are used.
Avoid guessing function names from repo examples without checking the stable docs first.

## When To Read More

Read `references/sources.md` for the stable documentation entry points.
Read `references/examples.md` for imports used in larger scripts.

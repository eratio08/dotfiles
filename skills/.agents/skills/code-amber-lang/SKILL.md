---
name: code-amber-lang
description: Teach Codex how to read, write, run, and debug Amber, a language compiled to Bash. Use when working with `.ab` files, Amber syntax, Amber CLI commands, Bash interop, Amber imports and standard library usage, or when converting shell scripts into Amber with explicit failure handling.
---

# Amber Lang

Treat Amber as a safe scripting language that compiles to Bash.
Prefer it when the output still needs to be a shell script, but the task benefits from clearer syntax, basic static types, imports, and explicit failure handling.

## Quickstart Shape

Most executable Amber scripts should look roughly like this:

```amber
import { join } from "std/text"

fun render(name: Text): Text {
    return join(["Hello", name], " ")
}

main(args) {
    echo(render("Amber"))
}
```

Use imports first.
Put reusable logic in typed `fun` functions.
Use `main(args)` as the entrypoint for executable scripts.

## Work In Amber Style

Write small, direct scripts.
Keep logic in typed `fun` functions.
Use `main(args)` as the entrypoint for executable scripts.
Import stdlib functions from `"std/..."`.
Use `$ ... $` for shell commands.
Handle failure explicitly with `failed { ... }`, `failed(code) { ... }`, or `?`.
Use `trust` only when shell-style unsafe behavior is intentional.

Default to these language features in the main flow:
- `let` and `const`
- `Text`, `Int`, `Num`, `Bool`, `Null`, and `[T]`
- `fun` and `pub fun`
- `if`, `else`, `for`, and `while`
- string interpolation with `{name}`

## Core Syntax

Declare mutable bindings with `let`.
Declare immutable bindings with `const`.
Annotate parameters as `name: Type`.
Annotate return types as `): Type`.
Use `Null` for functions that do not return a useful value.
Use `[T]` for arrays.

Typical forms:

```amber
let name: Text = "Amber"
const retries: Int = 3
let ok: Bool = true
let names: [Text] = ["a", "b"]

fun greet(name: Text): Text {
    return "Hello {name}"
}

pub fun add(a: Int, b: Int): Int {
    return a + b
}
```

## Control Flow

Use `if` and `else` for branching.
Use `for item in items` for array iteration.
Use `while condition` for repeated loops.

```amber
if len(args) > 0 {
    echo("arg: {args[0]}")
} else {
    echo("no args")
}

for name in ["Ada", "Linus"] {
    echo(name)
}

while false {
    echo("unreachable")
}
```

## Commands And Interop

Use `$ ... $` for shell commands.
Treat command execution as an Amber expression with explicit failure handling.
Capture output by assigning the command expression to a variable.

```amber
const branch = $ git branch --show-current $ failed(code) {
    echo("git failed: {code}")
    exit(1)
}
```

Use string interpolation inside commands when needed.
Reach for raw shell commands when the external Unix tool is the clearest implementation.

## Failure Model

Amber is designed around explicit handling of failure.
Commands and failable functions should not silently continue the way plain Bash often does.

Use `failed { ... }` or `failed(code) { ... }` to recover inline.
Mark failable return types with `?`.
Use `?` at the call site to propagate failure upward.
Use `fail <code>` inside a failable function when it must stop with a status.
Use `trust` only when bypassing Amber's safety model is truly intentional.

```amber
fun load(path: Text): Text? {
    const content = $ cat {path} $ failed(code) {
        fail code
    }
    return content
}

main(args) {
    const content = load("config.txt")?
    echo(content)
}
```

## Imports And Modules

Builtins do not require imports.
Import stdlib functions from `"std/<module>"`.
Use named imports when only a few helpers are needed.
Use `import *` only when many helpers from the same module are used.

Common starting points:
- `std/text`
- `std/fs`
- `std/env`
- `std/http`
- `std/test`

## Default Workflow

Use `amber check file.ab` before trying to run or build.
Use `amber run file.ab` for compile-and-run.
Use `amber build input.ab output.sh` for distributable Bash output.
Use `amber test` when the file or project contains Amber tests.

## Safety Rules

Treat explicit failure handling as Amber's core feature.
Do not reach for `trust` as a shortcut.
Prefer `Int` over `Num` unless fractional math is required.
Remember that top-level code outside `main` runs on import.
Do not assume nested arrays are supported.
Treat `lines()` carefully if you use it.
Do not assume Bash idioms map directly to Amber if they bypass Amber's safety model.

## Read References As Needed

Read `references/syntax-cheatsheet.md` for a compact syntax map.
Read `references/failure-handling.md` before writing command-heavy or failable code.
Read `references/cli-workflow.md` for check, run, build, test, docs, and shebang workflows.
Read `references/stdlib-modules.md` when choosing imports or stdlib helpers.
Read `references/bash-interop.md` when mixing Amber with raw shell commands.
Read `references/examples.md` for larger worked examples and patterns.
Read `references/gotchas.md` for sharp edges and version-drift risks.
Read `references/sources.md` when you need the authoritative upstream sources used by this skill.

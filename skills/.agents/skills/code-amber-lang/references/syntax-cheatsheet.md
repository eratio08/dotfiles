# Syntax Cheatsheet

## Core Forms

Declare mutable bindings with `let`.
Declare immutable bindings with `const`.
Annotate parameters and return values with `name: Type` and `): Type`.
Declare functions with `fun`.
Export functions with `pub fun`.
Use `main(args)` for executable entrypoints.

## Types

Use `Text` for strings.
Use `Int` for integers.
Use `Num` for decimal arithmetic only when needed.
Use `Bool` for booleans.
Use `Null` for no-value returns.
Use `[T]` for arrays.

## Control Flow

Use `if condition { ... } else { ... }` for branching.
Use `for item in items { ... }` for iteration.
Use `while condition { ... }` for loops.
Use `return value` to return from functions.

## Strings And Commands

Use `"Hello {name}"` for interpolation.
Run shell commands with `$ command args $`.
Capture command output by assigning the command expression.
Handle command failure with `failed { ... }` or `failed(code) { ... }`.

## Imports

Import named stdlib items with `import { join } from "std/text"`.
Import whole modules with `import * from "std/text"`.
Re-export with `pub import * from "std/text"` when building libraries.

## Tiny Example

```amber
import { join } from "std/text"

fun greet(name: Text): Text {
    return join(["Hello", name], " ")
}

main(args) {
    echo(greet("Amber"))
}
```

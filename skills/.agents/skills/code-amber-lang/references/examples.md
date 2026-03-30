# Examples

## How To Use This File

Use this file for pattern selection, not as a copy-paste dump.
When possible, adapt the smallest matching pattern and then verify it with `amber check`.

## Minimal Executable Script

Use a small `main(args)` script with typed helpers for ordinary command-line tasks.

```amber
fun greet(name: Text) {
    echo("Hello, {name}")
}

main(args) {
    greet("Amber")
}
```

## Command Capture With Failure Handling

Use a command expression when the shell output is part of the data flow.

```amber
main(args) {
    const result = $ curl -s "https://wttr.in?format=1" $ failed(code) {
        echo("request failed: {code}")
        exit(1)
    }
    echo(result)
}
```

## Import And Reuse

Import named helpers from stable stdlib modules.

```amber
import { join } from "std/text"

fun render(parts: [Text]): Text {
    return join(parts, ", ")
}
```

## Testing Pattern

Use `std/test` assertions when the codebase includes Amber tests.

```amber
import { assert_eq } from "std/test"

test "sum works" {
    assert_eq(1 + 1, 2)
}
```

## Upstream Pattern Sources

Prefer stable documentation examples first.
Use the Amber docs by-example pages for larger scripts when they match the target version.
Use the `amber` repository's own Amber source files as supplemental examples for realistic project structure and shell-heavy scripts.
Check `references/sources.md` for the upstream locations.

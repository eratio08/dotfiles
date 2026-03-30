# Failure Handling

## Mental Model

Treat failure handling as the center of Amber's design.
Do not write Amber like plain Bash that keeps running after hidden command failures.

## Commands

Commands use `$ ... $`.
Commands can be statements or expressions.
When a command can fail, handle it intentionally.

Use `failed { ... }` to recover or report a generic failure.
Use `failed(code) { ... }` when the exit code matters.
Use `succeeded { ... }` when success needs a dedicated branch.
Use `exited(code) { ... }` when branching on the exact exit code is clearer.
Use `status` to inspect the latest exit status when needed.

## Failable Functions

Mark failable returns with `?`.
Use `?` at the call site to propagate failure upward.
Use `fail <code>` inside a failable function to stop with an exit status.

Prefer propagation with `?` when a helper cannot recover locally.
Prefer local `failed(...) { ... }` handling when the function can produce a useful user-facing message or fallback.

## Trust

Use `trust` sparingly.
`trust` intentionally disables Amber's normal safety expectations and moves behavior closer to raw Bash.
Only use it when failure is already guaranteed away or truly irrelevant.

## Decision Rules

If the script should stop and bubble failure upward, use a failable function and `?`.
If the script should recover, handle the command inline with `failed`.
If the script must preserve Bash-like permissiveness, use `trust` and be explicit about why.

## Tiny Example

```amber
fun read_config(path: Text): Text? {
    const content = $ cat {path} $ failed(code) {
        fail code
    }
    return content
}

main(args) {
    const config = read_config("config.txt")?
    echo(config)
}
```

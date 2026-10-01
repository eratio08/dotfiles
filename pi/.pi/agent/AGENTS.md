## Ripwire
Reach for it BEFORE blind grep + whole-file reads.
Call each nested Ripwire tool from `codemode` with `await`.
Use `path` for one repository root string or `paths` for an array of 1 to 16 roots.
- Orient on a task: `await tools.mcp__ripwire__for({ path: "<dir>", task: "<task>" })` returns a ranked, signatures-only inventory.
  Paste symbol/file names from the issue verbatim; named mentions get anchored.
- One task: `await tools.mcp__ripwire__explore({ path: "<dir>", task: "<task>", legend: "compact" })`.
  If you split one task across agents, set `partition` to an integer from 2 to 16.
  Read `lanes[].execution` from the result.
- When you have a stack trace or build error, call `await tools.mcp__ripwire__from_trace({ path: "<dir>", trace: "<raw trace text>", legend: "compact" })`.
  Pass the raw trace text in `trace`. Do not paraphrase it into a query.
  If the trace is in a file, use Pi `read` first and pass the file text.
- Who calls X: `await tools.mcp__ripwire__find_referencing_symbols({ path: "<dir>", symbol: "SYM" })` returns direct callers.
  Pass a symbol name or an `@FILE:LINE` location in `symbol`.
- Is it safe to change X? Use the full blast radius: `await tools.mcp__ripwire__impact({ path: "<dir>", symbol: "SYM", legend: "compact" })` plus `await tools.mcp__ripwire__uses({ path: "<dir>", symbol: "SYM", legend: "compact" })`.
  `uses` reports statically resolvable use sites with roles `call`, `read`, `write`, `import`, and `extends`.
- Apply a whole-symbol edit without a whole-file read: `await tools.mcp__ripwire__replace_symbol_body({ path: "<dir>", symbol: "SYM", new_body: "<complete definition>" })`.
  For insertion, use `await tools.mcp__ripwire__insert_before_symbol({ path: "<dir>", symbol: "SYM", text: "<text>" })` or `await tools.mcp__ripwire__insert_after_symbol({ path: "<dir>", symbol: "SYM", text: "<text>" })`.
  Use `file: "<path suffix>"` to disambiguate a symbol when needed.
  The receipt carries the `post-edit` span, `edit_check`, and `tests_to_run` by default.
  Use the receipt. Do not re-read the file.
  `await tools.mcp__ripwire__edit_check({ path: "<dir>", symbol: "SYM", legend: "compact" })` checks a contract without a replacement.
  Pass `new_body` to preview a replacement before you apply it.
- Before writing a new fn/class/helper: `await tools.mcp__ripwire__exemplar({ path: "<dir>", kind: "fn", legend: "compact" })`.
  `kind` accepts `fn`, `method`, `class`, `struct`, `iface`, or `var`.
  Pass a `task` string instead if you do not know the kind.
  Duplicates are born on small tasks.
- Before calling work done, run `await tools.mcp__ripwire__quality_delta({ path: "<dir>" })`.
  Then run `await tools.mcp__ripwire__situational_awareness({ path: "<dir>" })` to get `tests_to_run`.
  Run the returned test commands with Pi `bash`.
- Trust notes: counts marked `counts_floor` are floors, not totals; a zero means "none found", never "none exists".
- For tools that accept `legend`, use `"compact"` for terse definitions.
  Use `"full"` when you need a field's reasoning or a map for a human.

- Do NOT open a file you have not located first.
  Use `await tools.mcp__ripwire__for({ path: "<dir>", task: "<task>" })` or `await tools.mcp__ripwire__grep({ path: "<dir>", pattern: "<literal>" })`, then read what it names.
- Do NOT read a whole file to understand one symbol.
  Call `await tools.mcp__ripwire__find_symbol({ path: "<dir>", symbol: "SYM" })` for callers and callees.
  Call `await tools.mcp__ripwire__fetch_body({ path: "<dir>", handle: "<handle>" })` for the body.
- Do NOT fan reads across several files to learn one thing.
  Call `await tools.mcp__ripwire__explore({ path: "<dir>", task: "<task>", legend: "compact" })` once.


## General
- Use the `ast-grep` tool for structural code search and transformation.
* Use `tools.opensrc_fetch` to cache public source packages and repositories.
* Use `tools.opensrc_list`, `tools.opensrc_files`, or `tools.opensrc_tree` to locate cached sources and files.
* Use `tools.opensrc_grep` or `tools.opensrc_ast_grep` to search cached source.
* Use `tools.opensrc_read` or `tools.opensrc_read_many` to read cached files.
* Use the `gh` cli to access private repositories source code.
* Never commit anything to Git without the user's explicit instruction.
- Do not write any code comments, unless explicitly instructed.
- Do not remove any existing code comments which have not been introduced by yourself.
- Never guess. Always read up on facts when unsure.
- Follow principals of the book `A Philosophy of Software Design` from John Ousterhout.
- Use vertical space to separate logical units in logic.
- Never roll back changes not done by yourself without explicit consent.
- Never manually edit generated files e.g. bun.lock or package-lock.json; these files must be regenerated.

## Markdown
- In Markdown and pull request descriptions always use `ASD-STE100 Simplified Technical English`.
- In Markdown files, write one sentence per line.
- Never put a blank line between sentences of the same paragraph; a blank line starts a new paragraph.
- Group related sentences into multi-sentence paragraphs; do not make every sentence its own paragraph.
  Bad — every sentence is its own paragraph:
  ```markdown
        CodeRabbit runs on Windows.

        It requires PowerShell 5.1 or 7.

        Git must be on `PATH`.
  ```
  Good — sentences of one paragraph share a block:
  ```markdown
        CodeRabbit runs on Windows.
        It requires PowerShell 5.1 or 7.
        Git must be on `PATH`.
  ```

## Github
Never reply to a comment with "Thanks for asking" or similar phrases.

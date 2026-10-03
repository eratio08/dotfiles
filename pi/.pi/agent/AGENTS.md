## Ripwire
Reach for it BEFORE blind grep + whole-file reads.
Call each nested Ripwire tool from `codemode` with `await`.
- Orient on a task with `tools.mcp__ripwire__for`. It returns a ranked, signatures-only inventory.
  Paste symbol/file names from the issue verbatim; named mentions get anchored.
- Map one task with `tools.mcp__ripwire__explore`.
  If you split one task across agents, read each lane's `execution` instructions.
- Map a stack trace or build error with `tools.mcp__ripwire__from_trace`.
  Pass the raw trace text. Do not paraphrase it into a query.
  If the trace is in a file, use Pi `read` first.
- Find direct callers with `tools.mcp__ripwire__find_referencing_symbols`.
- Check a symbol's blast radius with `tools.mcp__ripwire__impact` and `tools.mcp__ripwire__uses`.
  `uses` reports statically resolvable use sites with roles `call`, `read`, `write`, `import`, and `extends`.
- Replace a whole symbol with `tools.mcp__ripwire__replace_symbol_body`.
  Insert before or after a symbol with `tools.mcp__ripwire__insert_before_symbol` or `tools.mcp__ripwire__insert_after_symbol`.
  The receipt carries the `post-edit` span, `edit_check`, and `tests_to_run` by default.
  Use the receipt. Do not re-read the file.
  Check a contract with `tools.mcp__ripwire__edit_check`.
- Before writing a new function, method, class, struct, interface, or variable, use `tools.mcp__ripwire__exemplar`.
  Duplicates are born on small tasks.
- Before calling work done, run `tools.mcp__ripwire__quality_delta`.
  Then run `tools.mcp__ripwire__situational_awareness` to get `tests_to_run`.
  Run the returned test commands with Pi `bash`.
- Trust notes: counts marked `counts_floor` are floors, not totals; a zero means "none found", never "none exists".

- Do NOT open a file you have not located first.
  Use `tools.mcp__ripwire__for` or `tools.mcp__ripwire__grep`, then read what it names.
- Do NOT read a whole file to understand one symbol.
  Use `tools.mcp__ripwire__find_symbol` for callers and callees.
  Use `tools.mcp__ripwire__fetch_body` for the body.
- Do NOT fan reads across several files to learn one thing.
  Use `tools.mcp__ripwire__explore` once.

## General
- Use `tools.ast_grep_search` for structural searches and `tools.ast_grep_rewrite` for structural edits.
* Use `tools.opensrc_fetch` to fetch public github repositories.
* Use `tools.opensrc_list`, `tools.opensrc_files`, or `tools.opensrc_tree` to locate public github sources and files.
* Use `tools.opensrc_grep` or `tools.opensrc_ast_grep` to search public github sources.
* Use `tools.opensrc_read` or `tools.opensrc_read_many` to read public github files.
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

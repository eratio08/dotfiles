## Ripwire
* Call these exact MCP tools before blind `grep` or whole-file reads.
* Orient on a task: call `ripwire_for` with `path` and `task`.
  Paste symbol and file names from the issue verbatim.
  Named mentions get anchored.
* Handle one task: call `ripwire_explore` with `path`, `task`, and optional `budget_tokens`.
  Before parallel agents, set `partition=N`, then read each returned `lanes[].execution`.
* Handle a stack trace or build error: call `ripwire_from_trace` with the raw `trace` text.
  If the trace is in a file, use the default Pi `read` tool first.
  Paste the error; do not paraphrase it into a query.
* Find who calls X: call `ripwire_find_referencing_symbols` with `symbol`.
  To check whether X is safe to change, call `ripwire_impact` for the transitive blast radius and `ripwire_uses` for every read, write, and import site.
* Apply a whole-symbol edit without a whole-file read: call `ripwire_replace_symbol_body` with `path`, `symbol`, and complete `new_body`.
  For insertion, call `ripwire_insert_before_symbol` or `ripwire_insert_after_symbol`.
  Use the returned receipt; do not re-read the whole file.
  For a contract check without an edit, call `ripwire_edit_check`.
* Before writing a new function, class, or helper, call `ripwire_exemplar` with the task or `kind`.
  Reuse the repository's best existing pattern.
* Before calling work done, call `ripwire_quality_delta`.
  Then call `ripwire_situational_awareness` to get `tests_to_run`, and run those tests with the default Pi `bash` tool.
  No `ripwire_test_gate` MCP tool is exposed.
* Treat `counts_floor` as a floor, not a total.
  A zero means “none found”, never “none exists”.
* Do not open a file that you have not located first.
  Use `ripwire_for` or `ripwire_grep`, then use the default Pi `read` tool on the paths they return.
* Do not read a whole file to understand one symbol.
  Call `ripwire_find_symbol`, then call `ripwire_fetch_body` with its returned handle.
* Do not fan reads across several files to learn one thing.
  Call `ripwire_explore` once for the task.

## General
* Use the `opensrc_execute` to access public github repositories source code.
* Use the `gh` cli to access private repositories source code.
* Never commit anything to Git without the user's explicit instruction.
- Use the `ast-grep` tool for structural code search and transformation
- Follow principals of the book `A Philosophy of Software Design` from John Ousterhout
- Do not write any code comments, unless explicitly instructed
- Do not remove any existing code comments which have not been introduced by yourself
- Never guess. Always read up on facts when unsure.

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

## Ripwire
Reach for it BEFORE blind grep + whole-file reads.
- Orient on a task: `mcp({ tool: "ripwire_for", args: '{"path":"<dir>","task":"<task in words>"}' })` — ranked, quality-annotated signatures.
  Paste symbol/file names from the issue verbatim; named mentions get anchored.
- One task: `mcp({ tool: "ripwire_explore", args: '{"path":"<dir>","task":"<task>","legend":"compact"}' })`; before parallel agents, set `"partition":N` in args (2–16), then read `lanes[].execution`.
- Have a stack trace / build error: `mcp({ tool: "ripwire_from_trace", args: '{"path":"<dir>","trace":"<raw trace text>","legend":"compact"}' })` — paste the error in trace, do not paraphrase it into a query.
  If the trace is in a file, use Pi `read` first and pass the file text.
- Who calls X: `mcp({ tool: "ripwire_find_referencing_symbols", args: '{"path":"<dir>","symbol":"SYM"}' })` (direct callers).
  "Is it safe to change X?" needs the full blast radius: `mcp({ tool: "ripwire_impact", args: '{"path":"<dir>","symbol":"SYM","legend":"compact"}' })` (transitive) plus `mcp({ tool: "ripwire_uses", args: '{"path":"<dir>","symbol":"SYM","legend":"compact"}' })` (statically resolvable read/write/import sites).
- Apply a whole-symbol edit without a whole-file Read: `mcp({ tool: "ripwire_replace_symbol_body", args: '{"path":"<dir>","symbol":"SYM","new_body":"<complete definition>"}' })` (or use `ripwire_insert_before_symbol` / `ripwire_insert_after_symbol` with symbol and text).
  The receipt carries the `post-edit` span, `edit_check`, and `tests_to_run` by default.
  Use the receipt, do not re-read the file.
  `mcp({ tool: "ripwire_edit_check", args: '{"path":"<dir>","symbol":"SYM","legend":"compact"}' })` is for a contract question without an edit in hand.
- Before writing a new fn/class/helper: `mcp({ tool: "ripwire_exemplar", args: '{"path":"<dir>","task":"<what you are writing>","legend":"compact"}' })` — pass kind instead of task if you know the kind.
  Duplicates are born on small tasks.
- Before calling work done: `mcp({ tool: "ripwire_quality_delta", args: '{"path":"<dir>"}' })` (what you made worse), then `mcp({ tool: "ripwire_situational_awareness", args: '{"path":"<dir>"}' })` for `tests_to_run`.
  Run the returned test commands with Pi `bash`.
- Trust notes: counts marked `counts_floor` are floors, not totals; a zero means "none found", never "none exists".
- For tools that accept legend, use "compact" for terse definitions of the attributes present.
  Use "full" when a definition's reasoning is needed: a term you do not recognize, a floor or cap you need explained, or a map a human will read.

 - Do NOT open a file you have not located first: use `ripwire_for` or `ripwire_grep`, then read what it names.
 - Do NOT read a whole file to understand one symbol: call `ripwire_find_symbol`, then `ripwire_fetch_body` with its returned handle for the body and callee signatures.
 - Do NOT fan reads across several files to learn one thing: call `ripwire_explore` with path, task, and legend: "compact" once.

## General
- Use the `ast-grep` tool for structural code search and transformation.
* Use the `opensrc` to access public github repositories source code.
* Use the `gh` cli to access private repositories source code.
* Never commit anything to Git without the user's explicit instruction.
- Do not write any code comments, unless explicitly instructed.
- Do not remove any existing code comments which have not been introduced by yourself.
- Never guess. Always read up on facts when unsure.
- Follow principals of the book `A Philosophy of Software Design` from John Ousterhout.
- Use vertical space to separate logical units in logic.
- Never roll back changes not done by yourself without explicit consent.

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

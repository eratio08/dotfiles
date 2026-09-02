* Use `code-index` as the default path for coding tasks, for other task these steps can be omitted.
* Start with `code-index_set_project_path` for the current project.
* Then run `code-index_build_deep_index` before substantial analysis.
* Use `code-index_find_files` for filename or path lookup.
* Use `code-index_search_code_advanced` for content and symbol search.
* Use `code-index_get_file_summary` before reading a full file.
* Use `code-index_get_symbol_body` when one function, method, or class is enough.
* Prefer `code-index` tools before broad read, glob, or manual scanning.
* If results look stale after file changes or branch switches, run `code-index_refresh_index` and retry.
* Default order: set path -> build index -> find/search -> summary/symbol -> targeted reads.

* Use the `opensrc_execute` to access public github repositories source code.
* Use the `gh` cli to access private repositories source code.
* Never commit anything to Git without the user's explicit instruction.

- Use the `ast-grep` tool for structural code search and transformation

- In Markdown files, write one sentence per line.
- Never put a blank line between sentences of the same paragraph; a blank line starts a new paragraph.
- Group related sentences into multi-sentence paragraphs; do not make every sentence its own paragraph.

Bad — every sentence is its own paragraph:

    CodeRabbit runs on Windows.

    It requires PowerShell 5.1 or 7.

    Git must be on `PATH`.

Good — sentences of one paragraph share a block:

    CodeRabbit runs on Windows.
    It requires PowerShell 5.1 or 7.
    Git must be on `PATH`.

- In Markdown and pull request descriptions always use `ASD-STE100 Simplified Technical English`.

- Do not write any code comments, unless explicitly instructed
- Do not remove any existing code comments which have not been introduced by yourself
- Never guess. Always read up on facts when unsure.

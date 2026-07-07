* Use `code-index` as the default path for coding tasks.
* Start with `code-index_set_project_path` for the current project.
* Then run `code-index_build_deep_index` before substantial analysis.
* Use `code-index_find_files` for filename or path lookup.
* Use `code-index_search_code_advanced` for content and symbol search.
* Use `code-index_get_file_summary` before reading a full file.
* Use `code-index_get_symbol_body` when one function, method, or class is enough.
* Prefer `code-index` tools before broad read, glob, or manual scanning.
* If results look stale after file changes or branch switches, run `code-index_refresh_index` and retry.
* Default order: set path -> build index -> find/search -> summary/symbol -> targeted reads.
- Use the `ast-grep` tool for structural code search and transformation
- Use LaTeX-like one sentence per line style when wiring markdown markdown documents
- Do not write any code comments, unless explicitly instructed
- Do not remove any existing code comments which have not been introduced by yourself

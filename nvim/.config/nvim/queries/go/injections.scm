;; extends

; sql
; a general query injection
([
  (interpreted_string_literal_content)
  (raw_string_literal_content)
  ] @injection.content
 (#match? @injection.content "(SELECT|INSERT|UPDATE|DELETE|ALTER|GRANT|CREATE|DROP|ANALYZE|VACUUM|COPY|REINDEX|COMMENT|TRUNCATE).+(FROM|INTO|VALUES|SET|SCHEMA|TABLE|ON|VERBOSE|ANALYZE|FULL|setval|TO|INDEX|SEQUENCE|VIEW|EXISTS).*(WHERE|GROUP BY|LIMIT|OFFSET)?")
(#set! injection.language "sql"))

; fallback comment based injection
([
  (interpreted_string_literal_content)
  (raw_string_literal_content)
 ] @injection.content
 (#contains? @injection.content "--sql")
 (#set! injection.language "sql"))

; html
; a general query injection
([
  (interpreted_string_literal_content)
  (raw_string_literal_content)
  ] @injection.content
 (#match? @injection.content "(<!DOCTYPE html>|<html|<head|<body|<div).*(</html>|</head>|</body>|</div>)?")
(#set! injection.language "html"))


; ----------------------------------------------------------------
; source: https://github.com/ray-x/go.nvim/tree/master/queries
; json
((const_spec
  name: (identifier) @_const
  value: (expression_list (raw_string_literal) @json))
 (#lua-match? @_const ".*[J|j]son.*"))

; jsonStr := `{"foo": "bar"}`
((short_var_declaration
    left: (expression_list
            (identifier) @_var)
    right: (expression_list
             (raw_string_literal) @json))
  (#lua-match? @_var ".*[J|j]son.*")
  (#offset! @json 0 1 0 -1))

; nvim 0.10
(const_spec
  name: (identifier)
  value: (expression_list
	   (raw_string_literal
	     (raw_string_literal_content) @injection.content
             (#lua-match? @injection.content "^[\n|\t| ]*\{.*\}[\n|\t| ]*$")
             (#set! injection.language "json")
	    )
   ))

(short_var_declaration
    left: (expression_list (identifier))
    right: (expression_list
             (raw_string_literal
               (raw_string_literal_content) @injection.content
               (#lua-match? @injection.content "^[\n|\t| ]*\{.*\}[\n|\t| ]*$")
               (#set! injection.language "json"))
               )
    )

(var_spec
  name: (identifier)
  value: (expression_list
           (raw_string_literal
             (raw_string_literal_content) @injection.content
             (#lua-match? @injection.content "^[\n|\t| ]*\{.*\}[\n|\t| ]*$")
             (#set! injection.language "json")
             )
   ))


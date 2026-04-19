[
  "module"
  "exposing"
  "import"
  "as"
  "type"
  "alias"
  "let"
  "in"
  "if"
  "then"
  "else"
  "case"
  "of"
  "foreign"
  "port"
] @keyword

[
  "+"
  "-"
  "*"
  "/"
  "%"
  "++"
  "::"
  "=="
  "!="
  "/="
  "<"
  "<="
  ">"
  ">="
  "&&"
  "||"
  "|>"
  "<|"
  ">>"
  "<<"
  "|"
  "->"
  "="
] @operator

["(" ")"] @punctuation.bracket
["{" "}"] @punctuation.bracket
["[" "]"] @punctuation.bracket

["," "." ":"] @punctuation.delimiter

"\\" @punctuation.special

(module_declaration
  (module_name
    (upper_identifier) @module))

(import_declaration
  (module_name
    (upper_identifier) @module))

(import_alias
  (upper_identifier) @module)

(foreign_import_declaration
  (string) @string)

(type_declaration
  name: (upper_identifier) @type)

(type_alias_declaration
  name: (upper_identifier) @type)

(type_variant
  (upper_identifier) @constructor)

(type_reference
  (upper_identifier) @type)

(type_variable
  (lower_identifier) @type)

(record_type_field
  name: (lower_identifier) @variable.other.member)

(type_annotation_declaration
  name: (lower_identifier) @function)

(type_annotation_declaration
  name: (upper_identifier) @type)

(function_declaration
  name: (lower_identifier) @function)

(variable_pattern
  (lower_identifier) @variable)

(wildcard_pattern) @variable.builtin

(constructor_pattern
  (upper_identifier) @constructor)

(constructor_ref) @constructor

(as_pattern
  "as" @keyword
  (lower_identifier) @variable)

(variable_expression
  (lower_identifier) @variable)

(constructor_expression
  (upper_identifier) @constructor)

(field_access_expression
  (lower_identifier) @variable.other.member)

(field_accessor
  (lower_identifier) @variable.other.member)

(record_field
  name: (lower_identifier) @variable.other.member)

(record_update_expression
  (lower_identifier) @variable)

(lambda_expression
  "\\" @punctuation.special)

(integer) @constant.numeric.integer
(float) @constant.numeric.float
(string) @string
(char) @constant.character
(escape_sequence) @constant.character.escape

(unit_expression) @constant.builtin

((constructor_expression
  (upper_identifier) @constant.builtin)
  (#match? @constant.builtin "^(True|False|Nothing|Just|Ok|Err)$"))

(exposed_value
  (lower_identifier) @function)
(exposed_type
  (upper_identifier) @type)
(double_dot) @punctuation.special

(line_comment) @comment.line
(block_comment) @comment.block

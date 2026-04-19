(function_declaration) @local.scope
(lambda_expression) @local.scope
(let_expression) @local.scope
(case_branch) @local.scope

(function_declaration
  name: (lower_identifier) @local.definition)

(let_binding
  (variable_pattern
    (lower_identifier) @local.definition))

(variable_pattern
  (lower_identifier) @local.definition)

(variable_expression
  (lower_identifier) @local.reference)

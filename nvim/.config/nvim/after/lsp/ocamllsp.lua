return {
  settings = {
    codelens = { enable = true },
    inlayHints = { enable = true },
    syntaxDocumentation = { enable = true },
  },
  get_language_id = function (_, lang)
    local map = {
      ['ocaml.mlx'] = 'ocaml',
    }
    return map[lang] or lang
  end,
  filetypes = {
    'ocaml',
    'ocaml.interface',
    'ocaml.menhir',
    'ocaml.cram',
    'ocaml.mlx',
    'ocaml.ocamllex',
    'reason',
    'dune',
  },
}

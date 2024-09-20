return {
  'nvim-tree/nvim-web-devicons',
  config = function ()
    local devicons = require('nvim-web-devicons')
    local ocaml_icon, ocaml_color = devicons.get_icon_color('ml', 'ocaml')
    devicons.set_icon {
      mlx = {
        icon = ocaml_icon,
        color = ocaml_color,
        name = 'mlx',
      },
      re = {
        icon = ocaml_icon,
        color = '#dd4B39',
        name = 'reason',
      },
      dune = {
        icon = ocaml_icon,
        color = '#b0b1b0',
        name = 'dune',
      },
      ['dune-project'] = {
        icon = ocaml_icon,
        color = '#b0b1b0',
        name = 'dune-project',
      },
    }
  end,
}

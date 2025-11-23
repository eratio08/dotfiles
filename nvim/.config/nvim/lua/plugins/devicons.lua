return {
  enabled = true,
  'nvim-tree/nvim-web-devicons',
  event = 'VeryLazy',
  config = function ()
    local devicons = require('nvim-web-devicons')
    local ocaml_icon, ocaml_color = devicons.get_icon_color('ml', 'ocaml')
    local go_icon, go_color = devicons.get_icon_color('go', 'go')
    devicons.set_icon({
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
      dingo = {
        icon = go_icon,
        color = go_color,
        name = 'dingo',
      },
      ['go.map'] = {
        icon = go_icon,
        color = go_color,
        name = 'dingo',
      },
    })
  end,
}

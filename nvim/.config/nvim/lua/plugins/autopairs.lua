return {
  'windwp/nvim-autopairs',
  lazy = false,
  config = function ()
    local npairs = require('nvim-autopairs')
    npairs.setup({
      enable_check_bracket_line = false,
      ignored_next_char = '[%w%.]', -- will ignore alphanumeric and `.` symbol
      check_ts = true,
      ts_config = {
        lua = { 'string' },
        javascript = { 'template_string' },
      },
      disable_filetype = { 'ocaml' },
    })

    local Rule = require('nvim-autopairs.rule')
    local ts_conds = require('nvim-autopairs.ts-conds')
    npairs.add_rules({
      Rule('%', '%', 'lua'):with_pair(ts_conds.is_ts_node({ 'string', 'comment' })),
      Rule('$', '$', 'lua'):with_pair(ts_conds.is_not_ts_node({ 'function' }))
    })
  end
}

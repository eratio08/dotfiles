return {
  enabled = true,
  'cshuaimin/ssr.nvim',
  keys = {
    { '<leader>sr', function () require('ssr').open() end, desc = 'Structured Search & Replace' },
  },
  config = function ()
    require('ssr').setup({
      border = 'rounded',
      min_width = 50,
      min_height = 5,
      max_width = 120,
      max_height = 25,
      adjust_window = true,
      keymaps = {
        close = 'q',
        next_match = 'n',
        prev_match = 'N',
        replace_confirm = '<cr>',
        replace_all = '<leader><cr>',
      },
    })
  end
}

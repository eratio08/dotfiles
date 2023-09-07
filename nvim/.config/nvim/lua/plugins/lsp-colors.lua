return {
  'folke/lsp-colors.nvim',
  lazy = false,
  config = function ()
    local lsp_colors = require('lsp-colors')

    lsp_colors.setup({
      Error = '#eb6f92',
      Warning = '#f6c177',
      Information = '#9ccfd8',
      Hint = '#31748f'
    })
  end
}

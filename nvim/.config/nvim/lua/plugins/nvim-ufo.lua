return {
  'kevinhwang91/nvim-ufo',
  event = 'BufEnter',
  dependencies = { 'kevinhwang91/promise-async', 'nvim-treesitter/nvim-treesitter' },
  config = function ()
    --- @diagnostic disable: unused-local
    local ufo = require('ufo')
    ufo.setup({
      provider_selector = function (_bufnr, _filetype, _buftype)
        return { 'treesitter', 'indent' }
      end,
    })

    require('which-key').register({
      z = {
        title = 'Fold',
        R = { ufo.openAllFolds, 'Open all' },
        M = { ufo.closeAllFolds, 'Close all' },
      }
    })
  end
}

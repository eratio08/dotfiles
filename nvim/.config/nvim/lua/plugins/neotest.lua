return {
  'nvim-neotest/neotest',
  keys = { 'tt' },
  dependencies = {
    'nvim-lua/plenary.nvim',
    'nvim-treesitter/nvim-treesitter',
    'antoinemadec/FixCursorHold.nvim',
    'marilari88/neotest-vitest',
    'folke/which-key.nvim',
  },
  config = function ()
    require('neotest').setup({
      adapters = {
        require('neotest-vitest')
      }
    })

    require('which-key').register({
      ['t'] = {
        name = 'Test',
        t = { require('neotest').run.run, 'Nearest' },
      },
    })
  end,
}

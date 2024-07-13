return {
  'nvim-neotest/neotest',
  dependencies = {
    'nvim-neotest/nvim-nio',
    'nvim-lua/plenary.nvim',
    'antoinemadec/FixCursorHold.nvim',
    'nvim-treesitter/nvim-treesitter',
    'marilari88/neotest-vitest',
    'folke/which-key.nvim',
  },
  keys = { { 'tt', desc = 'Test nearest' } },
  config = function ()
    require('neotest').setup({
      adapters = {
        require('neotest-vitest')
      }
    })
    require('which-key').add({
      { 'tt', require('neotest').run.run, 'Test Nearest' }
    })
  end,

}

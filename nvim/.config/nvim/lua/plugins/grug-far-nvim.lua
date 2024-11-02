return {
  'MagicDuck/grug-far.nvim',
  dependencies = {
    'nvim-tree/nvim-web-devicons',
    'folke/which-key.nvim',
  },
  keys = {
    { '<leader>G', group = 'Grug-Far current word' },
    { '<leader>Gf', desc = 'Grug-Far current file' },
  },
  config = function ()
    local grug_far = require('grug-far')
    grug_far.setup({
      -- engine = 'astgrep',
    })
    require('which-key').add({
      { '<leader>G', group = 'Grug-Far' },
      {
        '<leader>G',
        function ()
          grug_far.open({ prefills = { search = vim.fn.expand('<cword>') } })
        end,
        desc = 'Grug-Far current word',
      },
      { '<leader>Gf', function () grug_far.open({ prefills = { paths = vim.fn.expand('%') } }) end, desc = 'Grud-Far current file' },
      { '<leader>Ga', function () grug_far.open({ engine = 'astgrep' }) end, desc = 'Grug-Far astgrep' },
    })
  end
}

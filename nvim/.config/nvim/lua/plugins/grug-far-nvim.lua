return {
  enabled = true,
  'MagicDuck/grug-far.nvim',
  dependencies = {
    'nvim-tree/nvim-web-devicons',
    'folke/which-key.nvim',
  },
  keys = {
    { '<leader>gf', desc = 'Grug-Far' },
    { '<leader>gw', desc = 'Grug-Far current word' },
    { '<leader>gF', desc = 'Grud-Far current file' },
    { '<leader>ga', desc = 'Grug-Far astgrep' },
  },
  config = function ()
    local grug_far = require('grug-far')
    grug_far.setup({
      -- engine = 'astgrep',
    })
    require('which-key').add({
      {
        '<leader>g',
        function () grug_far.open() end,
        desc = 'Grug-Far'
      },
      {
        '<leader>gw',
        function () grug_far.open({ prefills = { search = vim.fn.expand('<cword>') } }) end,
        desc = 'Grug-Far current word'
      },
      {
        '<leader>gf',
        function () grug_far.open({ prefills = { paths = vim.fn.expand('%') } }) end,
        desc = 'Grud-Far current file'
      },
      {
        '<leader>ga',
        function () grug_far.open({ engine = 'astgrep' }) end,
        desc = 'Grug-Far astgrep'
      },
    })
  end
}

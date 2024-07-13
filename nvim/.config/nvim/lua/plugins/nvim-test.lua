return {
  enabled = false,
  'klen/nvim-test',
  keys = { { 'tt', desc = 'Test nearest' } },
  dependencies = {
    'folke/which-key.nvim',
  },
  config = function ()
    require('nvim-test').setup({
      term = 'toggleterm',
      termOpts = {
        direction = 'float',
      },
    })

    require('which-key').add({
      { 'tt', group = 'Test' },
      { 'tt', ':TestNearest<CR>', desc = 'nearest' },
      { 'tt', ':TestFile<CR>', desc = 'file' },
      { 'tt', ':TestSuite<CR>', desc = 'suite' },
      { 'tt', ':TestLast<CR>', desc = 'last' },
    })
  end
}

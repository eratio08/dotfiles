return {
  'nvim-pack/nvim-spectre',
  enabled = false,
  dependencies = {
    'nvim-lua/plenary.nvim',
    'nvim-tree/nvim-web-devicons',
    'folke/which-key.nvim',
  },
  keys = {
    { '<leader>S', desc = 'Spectre' },
    { '<leader>Sw', desc = 'Search current word' },
    { '<leader>Sp', desc = 'Search on current file' },
  },
  cmd = { 'Spectre' },
  config = function ()
    local spectre = require('spectre')
    spectre.setup()
    require('which-key').add({
      { '<leader>S', group = 'Spectre' },
      { '<leader>S', spectre.toggle, desc = 'Spectr toogle' },
      { '<leader>Sw', function () spectre.open_visual({ select_word = true }) end, desc = 'Search current word' },
      { '<leader>Sw', function () spectre.open_visual() end, desc = 'Search current word', mode = 'v' },
      { '<leader>Sp', function () spectre.open_file_search({ select_word = true }) end, desc = 'Search on current file' },
    })
  end
}

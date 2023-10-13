return {
  'mbbill/undotree',
  keys = { '<leader>u' },
  dependencies = {
    { 'folke/which-key.nvim' }
  },
  config = function ()
    local wk = require('which-key')
    wk.register({
      ['<leader>'] = {
        u = { ':UndotreeToggle<CR>', 'Toggle Undotree' },
      },
    })
  end
}

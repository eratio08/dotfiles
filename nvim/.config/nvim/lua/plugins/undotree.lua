return {
  'mbbill/undotree',
  keys = { '<leader>u' },
  config = function ()
    local wk = require('which-key')
    wk.register({
      ['<leader>'] = {
        u = { ':UndotreeToggle<CR>', 'Toggle Undotree' },
      },
    })
  end
}

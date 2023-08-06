return {
  'mbbill/undotree',
  config = function ()
    local wk = require('which-key')
    wk.register({
      ['<leader>'] = {
        u = { ':UndotreeToggle<CR>', 'Toggle Undotree' },
      },
    })
  end
}

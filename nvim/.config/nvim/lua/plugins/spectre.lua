return {
  'nvim-pack/nvim-spectre',
  dependencies = { 'nvim-lua/plenary.nvim' },
  keys = { '<leader>S', '<leader>sw', '<leader>sp' },
  config = function ()
    require('spectre').setup()
    local wk = require('which-key')
    wk.register({
      ['<leader>'] = {
        S = { require('spectre').toggle, 'Spectr toogle' },
        ['Sw'] = { function () require('spectre').open_visual({ select_word = true }) end, 'Search current word' },
      },
    })
    wk.register({
      ['<leader>Sw'] = { function () require('spectre').open_visual() end, 'Search current word' },
    }, { mode = 'v' })
    wk.register({
      ['<leader>Sp'] = { function () require('spectre').open_file_search({ select_word = true }) end, 'Search on current file' },
    }, { mode = 'n' })
  end
}

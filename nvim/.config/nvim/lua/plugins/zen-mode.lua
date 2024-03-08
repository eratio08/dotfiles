return {
  'folke/zen-mode.nvim',
  keys = { '<leader>z' },
  dependencies = {
    'folke/which-key.nvim',
  },
  config = function ()
    require('zen-mode').setup({
      window = {
        backdrop = 0.8,
        options = {
          number = true,
          relativenumber = true,
        },
      },
      plugins = {
        options = {
          enabled = true,
          ruler = false,
        },
        tmux = { enabled = false },
        alacritty = {
          enabled = true,
          font = '+4',
        },
      },
    })

    require('which-key').register({
      ['<leader>'] = {
        name = 'Leader',
        z = { ':ZenMode<CR>', 'Toggle ZenMode' },
      },
    })
  end
}

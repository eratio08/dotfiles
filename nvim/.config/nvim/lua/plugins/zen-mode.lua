return {
  'folke/zen-mode.nvim',
  keys = { { '<leader>z', desc = 'Toggle ZenMode' } },
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

    require('which-key').add({
      { '<leader>z', ':ZenMode<CR>', desc = 'Toggle ZenMode' },
    })
  end
}

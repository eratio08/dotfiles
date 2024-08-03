return {
  'zbirenbaum/copilot.lua',
  -- event= 'VeryLazy',
  cmd = 'Copilot',
  event = 'InsertEnter',
  config = function ()
    require('copilot').setup({
      suggest = {
        keymap = {
          accept = '<C-j>',
        },
      },
      filetypes = {
        roc = false,
        ml = false,
      },
    })
  end,
}

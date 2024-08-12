return {
  'zbirenbaum/copilot.lua',
  cmd = 'Copilot',
  event = 'InsertEnter',
  config = function ()
    require('copilot').setup({
      suggestion = {
        auto_trigger = true,
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

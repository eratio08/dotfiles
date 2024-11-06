return {
  'zbirenbaum/copilot.lua',
  cmd = 'Copilot',
  event = 'InsertEnter',
  config = function ()
    require('copilot').setup({
      suggestion = {
        enabled = false,
        auto_trigger = true,
        keymap = {
          accept = '<C-j>',
        },
      },
      panel = {
        enabled = false,
      },
      filetypes = {
        -- roc = false,
        -- ocaml = false,
        -- elixir = false,
      },
    })
  end,
}

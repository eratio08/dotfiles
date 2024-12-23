return {
  'zbirenbaum/copilot.lua',
  cmd = 'Copilot',
  event = 'InsertEnter',
  config = function ()
    require('copilot').setup({
      suggestion = {
        enabled = true,
        auto_trigger = false,
        keymap = {
          accept = '<A-l>',
          next = '<A-]>',
          prev = '<A-[>',
          dismiss = '<esc>'
        },
      },
      panel = {
        enabled = false,
      },
      filetypes = {
        roc = false,
        ocaml = false,
        elixir = false,
      },
    })
  end,
}

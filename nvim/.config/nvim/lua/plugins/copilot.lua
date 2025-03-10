return {
  'zbirenbaum/copilot.lua',
  cmd = 'Copilot',
  event = 'BufReadPost',
  opts = {
    suggestion = {
      auto_trigger = false,
      keymap = {
        accept = '<tab>',
        next = '<M-]>',
        prev = '<M-[>',
      },
    },
    panel = { enabled = false },
    filetypes = {
      markdown = true,
      help = true,
      ocaml = false,
      roc = false,
      elixir = false,
    },
  },
}

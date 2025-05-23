return {
  'zbirenbaum/copilot.lua',
  cmd = 'Copilot',
  -- event = 'BufReadPost',
  keys = {
    { '<M-]>', desc = 'Copilot next' }
  },
  opts = {
    suggestion = {
      auto_trigger = false,
      keymap = {
        accept = '<M-CR>',
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
    -- copilot_node_command = '~/.asdf/shims/node',
  },
}

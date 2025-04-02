return {
  enabled = true,
  'folke/snacks.nvim',
  priority = 1000,
  lazy = false,
  ---@type snacks.Config
  opts = {
    bigfile = { enabled = true },
    bufdelete = { enabled = false },
    debug = { enabled = true },
    git = { enabled = false },
    gitbrowse = { enabled = true },
    lazygit = { enabled = true },
    notify = { enabled = false },
    notifier = { enabled = true },
    quickfile = { enabled = true },
    rename = { enabled = false },
    statuscolumn = { enabled = false },
    terminal = { enabled = false },
    toggle = { enabled = false },
    win = { enabled = false },
    words = { enabled = false },
    image = { enabled = false },
    picker = {
      ui_select = true,
    },
  },
  -- Snacks.notifier.show_history()
}

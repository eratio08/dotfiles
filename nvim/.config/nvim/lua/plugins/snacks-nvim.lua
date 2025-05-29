return {
  enabled = true,
  'folke/snacks.nvim',
  priority = 1000,
  lazy = false,
  keys = {
    { '<leader>h', ':lua Snacks.notifier.show_history()<CR>', desc = 'Snack Notification History' },
  },
  ---@module 'snacks'
  ---@type snacks.Config
  opts = {
    bigfile = { enabled = true },
    debug = { enabled = true },
    gitbrowse = { enabled = true },
    lazygit = { enabled = true },
    notifier = { enabled = true },
    quickfile = { enabled = true },
    picker = { ui_select = true },
    input = { enabled = true },
    toggle = { enabled = true },
    -- explorer = { enabled = true },
  },
  -- Snacks.notifier.show_history()
}

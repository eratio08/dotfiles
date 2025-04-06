return {
  enabled = true,
  'OXY2DEV/markview.nvim',
  dependencies = {
    'saghen/blink.cmp', -- enable completion
  },
  keys = {
    { '<leader>mv', ':Markview toggle<CR>', desc = 'View Markdown' },
  },
  ft = { 'markdown', 'copilot-chat', 'codecompanion' },
  ---@module 'markview'
  ---@type mkv.config
  opts = {
    -- Requires `:TSInstall markdown markdown_inline html latex typst yaml`
    preview = {
      icon_provider = 'internal',
      hybrid_modes = { 'n' },
      linewise_hybrid_mode = true,
    },
    html = {},
    latex = {},
    markdown_inline = {},
    markdown = {
      code_blocks = {
        sign = false,
      },
      headings = {
        heading_1 = {
          sign = false,
        },
        heading_2 = {
          sign = false,
        },
      },
    },
    typst = { enable = true },
    json = { enabled = false },
    yaml = {
      enable = false,
      properties = {
        enable = false
      }
    },
  },
}

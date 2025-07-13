return {
  enabled = true,
  'MeanderingProgrammer/render-markdown.nvim',
  dependencies = {
    'nvim-treesitter/nvim-treesitter',
    'nvim-tree/nvim-web-devicons',
    'rose-pine',
  },
  keys = {
    { '<leader>mr', ':RenderMarkdown toggle<CR>', desc = 'Render Markdown' },
  },
  ft = 'markdown',
  ---@module 'render-markdown'
  ---@type render.md.UserConfig
  opts = {
    render_modes = { 'n' },
    latex = { enabled = false },
    completions = { blink = { enabled = true } },
  },
}

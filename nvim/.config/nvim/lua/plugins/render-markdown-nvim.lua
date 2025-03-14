return {
  enabled = false,
  'MeanderingProgrammer/render-markdown.nvim',
  dependencies = {
    'nvim-treesitter/nvim-treesitter',
    'nvim-tree/nvim-web-devicons',
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
  },
}

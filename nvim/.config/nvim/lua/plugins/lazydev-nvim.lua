return {
  enabled = true,
  'folke/lazydev.nvim',
  ft = 'lua',
  dependencies = {
    'Bilal2453/luvit-meta',
    'justinsgithub/wezterm-types',
  },
  opts = {
    library = {
      { path = 'luvit-meta/library', words = { 'vim%.uv' } },
      { path = 'wezterm-types', mods = { 'wezterm' } },
      { path = 'plenary.nvim', words = { 'describe', 'it', 'before_each', 'after_each' } },
    },
  },
}

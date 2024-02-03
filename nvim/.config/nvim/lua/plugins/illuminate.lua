return {
  'RRethy/vim-illuminate',
  lazy = false,
  dependencies = {
    { 'rose-pine/neovim' },
  },
  config = function ()
    require('illuminate').configure({
      min_count_to_highlight = 2,
      under_cursor = false,
      filetypes_denylist = {
        'DressingSelect',
        'TelescopePrompt',
        'Outline',
        'TelescopePrompt',
        'alpha',
        'toggleterm',
        'neo-tree',
        'Spectre',
      },
    })

    local p = require('rose-pine.palette')
    vim.api.nvim_set_hl(0, 'IlluminatedWordText', { bg = p.highlight_med })
    vim.api.nvim_set_hl(0, 'IlluminatedWordRead', { bg = p.highlight_med })
    vim.api.nvim_set_hl(0, 'IlluminatedWordWrite', { bg = p.highlight_med })
  end
}

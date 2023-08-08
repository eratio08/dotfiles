return {
  'echasnovski/mini.comment',
  dependencies = {
    { 'nvim-treesitter/nvim-treesitter' },
    { 'JoosepAlviste/nvim-ts-context-commentstring' },
  },
  version = false,
  config = function ()
    require('nvim-treesitter.configs').setup({
      context_commentstring = {
        enable = true,
        enable_autocmd = false,
      },
    })

    require('mini.comment').setup({
      options = {
        custom_commentstring = function ()
          return require('ts_context_commentstring.internal').calculate_commentstring() or vim.bo.commentstring
        end,
      },
    })
  end
}

return {
  'echasnovski/mini.comment',
  dependencies = {
    { 'nvim-treesitter/nvim-treesitter' },
    { 'JoosepAlviste/nvim-ts-context-commentstring' },
  },
  version = false,
  config = function ()
    require('mini.comment').setup({
      options = {
        custom_commentstring = function ()
          return require('ts_context_commentstring.internal').calculate_commentstring() or vim.bo.commentstring
        end,
      },
    })
  end
}

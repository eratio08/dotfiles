return {
  'numToStr/Comment.nvim',
  dependencies = {
    { 'nvim-treesitter/nvim-treesitter' },
    { 'JoosepAlviste/nvim-ts-context-commentstring' },
  },
  config = function ()
    require('nvim-treesitter.configs').setup({
      context_commentstring = {
        enable = true,
        enable_autocmd = false,
      },
    })

    require('Comment').setup({
      pre_hook = require('ts_context_commentstring.integrations.comment_nvim').create_pre_hook(),
    })
  end,
}

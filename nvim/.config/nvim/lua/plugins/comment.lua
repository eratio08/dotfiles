return {
  'numToStr/Comment.nvim',
  keys = { 'gcc', { 'gc', mode = 'v' } },
  dependencies = {
    { 'nvim-treesitter/nvim-treesitter' },
    { 'JoosepAlviste/nvim-ts-context-commentstring' },
  },
  config = function ()
    require('Comment').setup({
      pre_hook = require('ts_context_commentstring.integrations.comment_nvim').create_pre_hook(),
    })
  end,
}

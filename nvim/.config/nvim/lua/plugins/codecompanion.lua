return {
  enabled = false,
  'olimorris/codecompanion.nvim',
  dependencies = {
    'nvim-lua/plenary.nvim',
    'nvim-treesitter/nvim-treesitter',
  },
  cmd = { 'CodeCompanionChat' },
  keys = {
    { '<leader>cc', ':CodeCompanionChat Toggle<CR>', desc = 'Toggle CodeCompanionChat' },
    { '<leader>cq', ':CodeCompanion', desc = 'Inline CodeCompanion' },
    { '<leader>cm', ':CodeCompanionCmd<CR>', desc = 'CodeCompanion Commands' },
    { '<leader>ca', ':CodeCompanionActions<CR>', desc = 'CodeCompanion Actions' },
  },
  config = true,
  opts = {
    adapters = {
      anthropic = function ()
        return require('codecompanion.adapters').extend('anthropic', {
          env = {
            api_key = 'cmd:op read op://employee/zcp7jc5d5byynqojxzbcpwd67y/password --no-newline',
          },
        })
      end,
      openai = function ()
        return require('codecompanion.adapters').extend('openai', {
          env = {
            api_key = 'cmd:op read op://employee/if556elvlh26lyqb3idfa2kkn4/password --no-newline',
          },
        })
      end,
    }
  },
}

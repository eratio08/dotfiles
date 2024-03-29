return {
  enabled = false,
  'folke/trouble.nvim',
  keys = { '<leader>tt' },
  dependencies = {
    'kyazdani42/nvim-web-devicons',
    'folke/which-key.nvim',
  },
  config = function ()
    local trouble = require('trouble')

    trouble.setup({
      position = 'bottom',
      height = 5,
    })

    local wk = require('which-key')
    wk.register({
      ['<leader>'] = {
        t = {
          name = 'Trouble',
          t = { ':TroubleToggle<CR>', 'Toggle' },
          w = { ':TroubleToggle workspace_diagnostics<CR>', 'Workspace Diagnostics' },
          d = { ':TroubleToggle document_diagnostics<CR>', 'Document Diagnostics' },
          q = { ':TroubleToggle quickfix<CR>', 'Quickfix' },
          l = { ':TroubleToggle loclist<CR>', 'LOC' },
          r = { ':TroubleToggle lsp_references<CR>', 'LSP References' }
        }
      }
    })
  end
}

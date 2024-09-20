return {
  enabled = false,
  'folke/trouble.nvim',
  keys = { '<leader>tt' },
  dependencies = {
    'nvim-tree/nvim-web-devicons',
    'folke/which-key.nvim',
  },
  config = function ()
    require('trouble').setup({
      position = 'bottom',
      height = 5,
    })

    require('which-key').add({
      { '<leader>tt', ':TroubleToggle<CR>', group = 'Trouble', desc = 'Trouble' },
      { '<leader>tw', ':TroubleToggle workspace_diagnostics<CR>', group = 'Trouble', desc = 'Workspace Diagnostics' },
      { '<leader>td', ':TroubleToggle document_diagnostics<CR>', group = 'Trouble', desc = 'Document Diagnostics' },
      { '<leader>tq', ':TroubleToggle quickfix<CR>', group = 'Trouble', desc = 'Quickfix' },
      { '<leader>tl', ':TroubleToggle loclist<CR>', group = 'Trouble', desc = 'LOC' },
      { '<leader>tr', ':TroubleToggle lsp_references<CR>', group = 'Trouble', desc = 'LSP References' },
    })
  end
}

return {
  'folke/trouble.nvim',
  enabled = false,
  keys = { { '<leader>t', desc = 'Trouble' } },
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
      { '<leader>t', group = 'Trouble' },
      { '<leader>tt', ':TroubleToggle<CR>', desc = 'Trouble' },
      { '<leader>tw', ':TroubleToggle workspace_diagnostics<CR>', desc = 'Workspace Diagnostics' },
      { '<leader>td', ':TroubleToggle document_diagnostics<CR>', desc = 'Document Diagnostics' },
      { '<leader>tq', ':TroubleToggle quickfix<CR>', desc = 'Quickfix' },
      { '<leader>tl', ':TroubleToggle loclist<CR>', desc = 'LOC' },
      { '<leader>tr', ':TroubleToggle lsp_references<CR>', desc = 'LSP References' },
    })
  end
}

-- nvim-treesitter/nvim-treesitter

if vim.g.plugs['nvim-treesitter'] then

local nvim_treesitter = require('nvim-treesitter.configs')

nvim_treesitter.setup {
  ensure_installed = {
      'html',
      'css',
      'javascript',
      'typescript',
      'json',
      'jsonc',
      'kotlin',
      'java',
      'lua',
      'vim',
  },
  highlight = {
    enable = true,
  },
  indent = {
    enable = true
  },
  incremental_selection = {
    enable = false,
    keymaps = {
      -- init_selection = "<Space>is",
      -- node_incremental = "<Space>sn",
      -- node_decremental = "<Space>snd",
      -- scope_incremental = "<Space>ss",
    },
  },
  textobjects = {
    enable = false,
  },
  -- enable ts_context_commentstring
  context_commentstring = {
    enable = true,
    enable_autocmd = false,
  },
}

-- enabled folding with treesitter
local opt = vim.opt
opt.foldmethod='expr'
opt.foldexpr='nvim_treesitter#foldexpr()'

if vim.g.plugs['spellsitter'] then
  -- prevents treesitter from spellchecking code
  require('spellsitter').setup()
end

end

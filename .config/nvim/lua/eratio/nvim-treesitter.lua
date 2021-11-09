-- nvim-treesitter/nvim-treesitter
local requireIfPresent = require('eratio.utils').requireIfPresent
local nvim_treesitter = requireIfPresent('nvim-treesitter.configs')

if not nvim_treesitter then
  return
end

nvim_treesitter.setup({
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
    enable = true,
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
  rainbow = {
    enable = true,
    extended_mode = false,
    max_file_lines = nil,
  },
})

-- enabled folding with treesitter
local opt = vim.opt
opt.foldmethod = 'expr'
opt.foldexpr = 'nvim_treesitter#foldexpr()'

local spellsitter = require('spellsitter')
if spellsitter then
  -- prevents treesitter from spellchecking code
  spellsitter.setup({
    enable = true,
    hl = 'SpellBad',
    spellchecker = 'vimfn',
  })
end

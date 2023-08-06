local lazypath = vim.fn.stdpath('data') .. '/lazy/lazy.nvim'
if not vim.loop.fs_stat(lazypath) then
  vim.fn.system({
    'git',
    'clone',
    '--filter=blob:none',
    'https://github.com/folke/lazy.nvim.git',
    '--branch=stable', -- latest stable release
    lazypath,
  })
end
vim.opt.rtp:prepend(lazypath)

require('lazy').setup({
  require('plugins.rose-pine'),
  require('plugins.telescope'),
  require('plugins.which-key'),
  require('plugins.trouble'),
  require('plugins.neodev'),
  require('plugins.zen-mode'),
  require('plugins.treesitter'),
  require('plugins.nvim-tree'),
  require('plugins.comment'),
  require('plugins.lsp-zero'),
  require('plugins.gitsigns'),
  require('plugins.toggleterm'),
  require('plugins.lualine'),
  require('plugins.autopairs'),
  -- require('plugins.mini-pairs'),
  -- require('plugins.mini-surround'),
  require('plugins.mini-comment'),
  require('plugins.nvim-test'),
  require('plugins.schemastore'),
  require('plugins.md-preview'),
  require('plugins.lsp-colors'),
  require('plugins.illuminate'),
  require('plugins.fidget'),
  -- require('plugins.noice'),
  { 'mbbill/undotree' },
  { 'tpope/vim-unimpaired' },
  { 'tpope/vim-fugitive' },
})

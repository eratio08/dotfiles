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
  require('eRatio.plugins.rose-pine'),
  require('eRatio.plugins.telescope'),
  require('eRatio.plugins.which-key'),
  require('eRatio.plugins.trouble'),
  require('eRatio.plugins.neodev'),
  require('eRatio.plugins.zen-mode'),
  require('eRatio.plugins.treesitter'),
  require('eRatio.plugins.comment'),
  require('eRatio.plugins.lsp-zero'),
  require('eRatio.plugins.gitsigns'),
  require('eRatio.plugins.toggleterm'),
  require('eRatio.plugins.lualine'),
  require('eRatio.plugins.mini-pairs'),
  require('eRatio.plugins.mini-surround'),
  require('eRatio.plugins.mini-comment'),
  require('eRatio.plugins.nvim-test'),
  require('eRatio.plugins.schemastore'),
  require('eRatio.plugins.md-preview'),
  require('eRatio.plugins.fidget'),
  require('eRatio.plugins.lsp-colors'),
  { 'mbbill/undotree' },
  { 'tpope/vim-unimpaired' },
  { 'tpope/vim-fugitive' },
})

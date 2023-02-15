local ensure_packer = function()
  local fn = vim.fn
  local install_path = fn.stdpath('data') .. '/site/pack/packer/start/packer.nvim'
  if fn.empty(fn.glob(install_path)) > 0 then
    fn.system({ 'git', 'clone', '--depth', '1', 'https://github.com/wbthomason/packer.nvim', install_path })
    vim.cmd [[packadd packer.nvim]]
    return true
  end
  return false
end

local packer_bootstrap = ensure_packer()

vim.cmd([[
augroup packer_user_config
autocmd!
autocmd BufWritePost packer.lua source <afile> | PackerCompile
augroup end
]])

return require('packer').startup(function(use)
  use('wbthomason/packer.nvim')
  use({
    'nvim-telescope/telescope.nvim',
    requires = {
      { 'nvim-lua/plenary.nvim' },
      { 'nvim-telescope/telescope-ui-select.nvim' },
    }
  })
  use({ 'nvim-telescope/telescope-fzf-native.nvim', run = 'make' })
  use({ "folke/which-key.nvim" })
  use({
    'rose-pine/neovim',
    as = 'rose-pine',
    config = function()
      vim.cmd('colorscheme rose-pine')
    end
  })
  use({
    'nvim-treesitter/nvim-treesitter',
    run = ':TSUpdate',
    requires = {
      { 'JoosepAlviste/nvim-ts-context-commentstring' }
    }
  })
  -- use('lukas-reineke/indent-blankline.nvim')
  use('mbbill/undotree')
  use('tpope/vim-unimpaired')
  use('tpope/vim-fugitive')
  use('numToStr/Comment.nvim')
  use({
    'VonHeikemen/lsp-zero.nvim',
    requires = {
      -- LSP Support
      { 'neovim/nvim-lspconfig' },
      { 'williamboman/mason.nvim' },
      { 'williamboman/mason-lspconfig.nvim' },

      -- Autocompletion
      { 'hrsh7th/nvim-cmp' },
      { 'hrsh7th/cmp-buffer' },
      { 'hrsh7th/cmp-path' },
      { 'saadparwaiz1/cmp_luasnip' },
      { 'hrsh7th/cmp-nvim-lsp' },
      { 'hrsh7th/cmp-nvim-lua' },
      { 'hrsh7th/cmp-emoji' },
      { 'ray-x/cmp-treesitter' },
      { 'onsails/lspkind-nvim' },
      { 'hrsh7th/cmp-nvim-lsp-signature-help' },

      -- Snippets
      { 'L3MON4D3/LuaSnip' },
      -- Snippet Collection (Optional)
      { 'rafamadriz/friendly-snippets' },
      -- null-ls
      { 'jose-elias-alvarez/null-ls.nvim' },
      { "jayp0521/mason-null-ls.nvim" },
    }
  })
  use({ 'folke/trouble.nvim', requires = { 'kyazdani42/nvim-web-devicons' } })
  use({ 'folke/neodev.nvim' })
  use({ 'nvim-tree/nvim-tree.lua', requires = { 'nvim-tree/nvim-web-devicons' } })
  use({ 'lewis6991/gitsigns.nvim' })
  use({ 'folke/lsp-colors.nvim' })
  use({ 'akinsho/toggleterm.nvim' })
  use({ 'nvim-lualine/lualine.nvim', requires = { 'kyazdani42/nvim-web-devicons' } })
  use({ "windwp/nvim-autopairs" })
  -- use { "b0o/schemastore.nvim" }
  use({ 'toppair/peek.nvim', run = 'deno task --quiet build:fast' })
  use({ 'folke/zen-mode.nvim' })
  use({
    "iamcco/markdown-preview.nvim",
    run = function() vim.fn["mkdp#util#install"]() end,
  })

  if packer_bootstrap then
    require('packer').sync()
  end
end)
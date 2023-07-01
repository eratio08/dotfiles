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
  {
    'rose-pine/neovim',
    name     = 'rose-pine',
    priority = 1000,
  },
  {
    'nvim-telescope/telescope.nvim',
    dependencies = {
      { 'nvim-lua/plenary.nvim' },
      {
        'nvim-telescope/telescope-ui-select.nvim',
        config = function () require('telescope').load_extension('ui-select') end
      },
      {
        'nvim-telescope/telescope-fzf-native.nvim',
        build  = 'make',
        config = function () require('telescope').load_extension('fzf') end
      },
      {
        'nvim-telescope/telescope-file-browser.nvim',
        config = function () require('telescope').load_extension 'file_browser' end
      }
    }
  },
  { 'folke/which-key.nvim' },
  { 'folke/trouble.nvim', dependencies = { 'kyazdani42/nvim-web-devicons' } },
  { 'folke/neodev.nvim' },
  { 'folke/zen-mode.nvim' },
  {
    'nvim-treesitter/nvim-treesitter',
    build = ':TSUpdate',
    dependencies = {
      { 'JoosepAlviste/nvim-ts-context-commentstring' },
      { 'nvim-treesitter/nvim-treesitter-textobjects' },
    }
  },
  { 'mbbill/undotree' },
  { 'tpope/vim-unimpaired' },
  { 'tpope/vim-fugitive' },
  { 'numToStr/Comment.nvim' },
  {
    'VonHeikemen/lsp-zero.nvim',
    branch = 'v2.x',
    dependencies = {
      -- LSP Support
      { 'neovim/nvim-lspconfig' },
      { 'williamboman/mason.nvim', build = ':MasonUpdate' },
      { 'williamboman/mason-lspconfig.nvim' },
      { 'j-hui/fidget.nvim', tag = 'legacy' },
      { 'folke/lsp-colors.nvim' },
      { 'ray-x/lsp_signature.nvim' },

      -- Autocompletion
      { 'hrsh7th/nvim-cmp' },
      { 'hrsh7th/cmp-buffer' },
      { 'hrsh7th/cmp-path' },
      { 'saadparwaiz1/cmp_luasnip' },
      { 'hrsh7th/cmp-nvim-lsp' },
      { 'hrsh7th/cmp-nvim-lua' },
      { 'hrsh7th/cmp-emoji' },
      { 'hrsh7th/cmp-cmdline' },
      { 'petertriho/cmp-git' },
      { 'ray-x/cmp-treesitter' },
      { 'onsails/lspkind-nvim' },
      { 'hrsh7th/cmp-nvim-lsp-signature-help' },

      -- Snippets
      { 'L3MON4D3/LuaSnip' },

      -- Snippet Collection (Optional)
      { 'rafamadriz/friendly-snippets' },

      -- null-ls
      -- { 'jose-elias-alvarez/null-ls.nvim' },
      -- { 'jayp0521/mason-null-ls.nvim' },
    }
  },
  { 'lewis6991/gitsigns.nvim' },
  { 'akinsho/toggleterm.nvim' },
  {
    'nvim-lualine/lualine.nvim',
    dependencies = { 'kyazdani42/nvim-web-devicons' }
  },
  { 'windwp/nvim-autopairs' },
  { 'klen/nvim-test' },
  { 'gpanders/editorconfig.nvim' },
  { 'b0o/schemastore.nvim' },
  {
    'iamcco/markdown-preview.nvim',
    build = function () vim.fn['mkdp#util#install']() end
  },
  {
    'nvim-tree/nvim-tree.lua',
    dependencies = {
      { 'nvim-tree/nvim-web-devicons', name = 'nvim-tree-nvim-web-devicons' },
    }
  },
  -- {
  --   'dpayne/CodeGPT.nvim',
  --   dependencies = {
  --     'nvim-lua/plenary.nvim',
  --     'MunifTanjim/nui.nvim',
  --   },
  --   config = function ()
  --     require('codegpt.config')
  --   end
  -- },
  -- use('lukas-reineke/indent-blankline.nvim')
})

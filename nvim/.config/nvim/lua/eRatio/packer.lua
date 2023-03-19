local ensure_packer = function ()
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

vim.api.nvim_create_augroup('packer_user_config', { clear = true })
vim.api.nvim_create_autocmd({ 'BufWritePost' }, {
  group = 'packer_user_config',
  pattern = 'packer.lua',
  command = 'source <afile> | PackerCompile'
})

return require('packer').startup({
  function (use)
    use({ 'wbthomason/packer.nvim' })
    use({
      'nvim-telescope/telescope.nvim',
      requires = {
        { 'nvim-lua/plenary.nvim' },
        { 'nvim-telescope/telescope-ui-select.nvim' },
      }
    })
    use({ 'nvim-telescope/telescope-fzf-native.nvim', run = 'make' })
    use({ 'folke/which-key.nvim' })
    use({ 'folke/trouble.nvim', requires = { 'kyazdani42/nvim-web-devicons' } })
    use({ 'folke/neodev.nvim' })
    use({ 'folke/zen-mode.nvim' })
    use({ 'rose-pine/neovim', as = 'rose-pine' })
    use({
      'nvim-treesitter/nvim-treesitter',
      run = ':TSUpdate',
      requires = {
        { 'JoosepAlviste/nvim-ts-context-commentstring' },
      }
    })
    use({ 'mbbill/undotree' })
    use({ 'tpope/vim-unimpaired' })
    use({ 'tpope/vim-fugitive' })
    use({ 'numToStr/Comment.nvim' })
    use({
      'VonHeikemen/lsp-zero.nvim',
      requires = {
        -- LSP Support
        { 'neovim/nvim-lspconfig' },
        { 'williamboman/mason.nvim' },
        { 'williamboman/mason-lspconfig.nvim' },
        { 'j-hui/fidget.nvim' },
        { 'folke/lsp-colors.nvim' },

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
        { 'jayp0521/mason-null-ls.nvim' },
      }
    })
    use({ 'nvim-tree/nvim-tree.lua', requires = { 'nvim-tree/nvim-web-devicons' } })
    use({ 'lewis6991/gitsigns.nvim' })
    use({ 'akinsho/toggleterm.nvim' })
    use({ 'nvim-lualine/lualine.nvim', requires = { 'kyazdani42/nvim-web-devicons' } })
    use({ 'windwp/nvim-autopairs' })
    use({ 'toppair/peek.nvim', run = 'deno task --quiet build:fast' }) -- markdown preview
    use({ 'klen/nvim-test' })
    use({ 'gpanders/editorconfig.nvim' })
    use { 'b0o/schemastore.nvim' }
    -- use('lukas-reineke/indent-blankline.nvim')

    if packer_bootstrap then
      require('packer').sync()
    end
  end,
  config = {
    display = {
      open_fn = require('packer.util').float,
    },
    profile = {
      enable = false,
      threshold = 1,
    },
  },
})

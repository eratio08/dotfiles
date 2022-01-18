" Maintainer: Eike Lurz <moin@elurz.de>

" Install vim-plug if not found
let data_dir = stdpath('data') . '/site'
if empty(glob(data_dir . '/autoload/plug.vim'))
  silent execute '!curl -fLo '.data_dir.'/autoload/plug.vim --create-dirs  https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim'
  autocmd VimEnter * PlugInstall --sync | source $MYVIMRC
endif

" Run PlugInstall if there are missing plugins
autocmd VimEnter * if len(filter(values(g:plugs), '!isdirectory(v:val.dir)'))
  \| PlugInstall --sync | source $MYVIMRC
\| endif

call plug#begin(stdpath('data') . '/plugged')
  " Theme
  Plug 'shaunsingh/nord.nvim'

  " Status bar
  Plug 'nvim-lualine/lualine.nvim'

  " test runner
  Plug 'vim-test/vim-test'

  " editor config support
  Plug 'editorconfig/editorconfig-vim'

  " emmet support
  " Plug 'mattn/emmet-vim'

  " Fugitive is the premier Vim plugin for Git.
  Plug 'tpope/vim-fugitive'

  " git line information
  Plug 'airblade/vim-gitgutter'

  " Commenting
  " Plug 'tpope/vim-commentary'
  Plug 'numToStr/Comment.nvim'

  " Surround.vim is all about surroundings: parentheses, brackets, quotes, XML tags, and more.
  " Plug 'tpope/vim-surround'

  " Collection of ][ helper mappings
  Plug 'tpope/vim-unimpaired'
  
  " rust support
  " Plug 'rust-lang/rust.vim'

  " nvim lsp configuration helper
  Plug 'neovim/nvim-lspconfig'
  Plug 'nvim-lua/lsp_extensions.nvim'
  Plug 'williamboman/nvim-lsp-installer'

  " completion
  Plug 'hrsh7th/nvim-cmp'
  Plug 'hrsh7th/cmp-nvim-lsp'
  Plug 'hrsh7th/cmp-nvim-lua'
  Plug 'hrsh7th/cmp-buffer'
  Plug 'hrsh7th/cmp-path'
  Plug 'hrsh7th/cmp-cmdline'
  Plug 'hrsh7th/cmp-emoji'
  Plug 'onsails/lspkind-nvim'

  " snippets
  Plug 'L3MON4D3/LuaSnip'
  Plug 'saadparwaiz1/cmp_luasnip'
  " Plug 'rafamadriz/friendly-snippets' 
  
  " debugger protocol support
  " Plug 'mfussenegger/nvim-dap'
  " Plug 'Pocco81/DAPInstall.nvim'
  " Plug 'David-Kunz/jester' " jest debugger

  " telescope, file finder
  Plug 'nvim-lua/plenary.nvim'
  Plug 'nvim-telescope/telescope.nvim'
  Plug 'nvim-telescope/telescope-fzy-native.nvim'
  Plug 'nvim-telescope/telescope-file-browser.nvim'

  " icons
  Plug 'kyazdani42/nvim-web-devicons'

  " nvim tree sitter
  Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}
  Plug 'lewis6991/spellsitter.nvim'
  Plug 'p00f/nvim-ts-rainbow'
  Plug 'JoosepAlviste/nvim-ts-context-commentstring'

call plug#end()

" load lua config
lua require 'eratio'

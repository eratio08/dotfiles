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
  Plug 'arcticicestudio/nord-vim'

  " Status bar
  Plug 'itchyny/lightline.vim'
  Plug 'itchyny/vim-gitbranch'

  " A collection of language packs for Vim.
  Plug 'sheerun/vim-polyglot'

  " formatter, fall back if lsp fails
  Plug 'sbdchd/neoformat'

  " test runner
  Plug 'vim-test/vim-test'

  " unicode inserion helper
  Plug 'chrisbra/unicode.vim'

  " editor config support
  Plug 'editorconfig/editorconfig-vim'

  " emmet support
  " Plug 'mattn/emmet-vim'

  " Fugitive is the premier Vim plugin for Git.
  Plug 'tpope/vim-fugitive'

  " git line information
  Plug 'airblade/vim-gitgutter'

  " Comment stuff out.
  Plug 'tpope/vim-commentary'

  " Surround.vim is all about surroundings: parentheses, brackets, quotes, XML tags, and more.
  Plug 'tpope/vim-surround'

  " Collection of ][ helper mappings
  Plug 'tpope/vim-unimpaired'
  
  " rust support
  " Plug 'rust-lang/rust.vim'

  " nvim lsp configuration helper
  Plug 'neovim/nvim-lspconfig'
  Plug 'nvim-lua/lsp_extensions.nvim'

  " completion
  Plug 'hrsh7th/cmp-nvim-lsp'
  Plug 'hrsh7th/cmp-buffer'
  Plug 'hrsh7th/nvim-cmp'

  " snippets
  Plug 'L3MON4D3/LuaSnip'
  Plug 'rafamadriz/friendly-snippets'
  
  " debugger protocol support
  Plug 'mfussenegger/nvim-dap'
  " Plug 'David-Kunz/jester' " jest debugger

  " telescope, file finder
  Plug 'nvim-lua/plenary.nvim'
  Plug 'nvim-telescope/telescope.nvim'
  Plug 'nvim-telescope/telescope-fzf-native.nvim', { 'do': 'make' }

  " nvim tree sitter
  Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}
  " Plug 'nvim-treesitter/completion-treesitter'

call plug#end()

" load lua config
lua require 'eratio'

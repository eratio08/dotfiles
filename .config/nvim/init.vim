" Maintainer: Eike Lurz <moin@elurz.de>

" Install vim-plug if not found
let data_dir = has('nvim') ? stdpath('data') . '/site' : '~/.vim'
if empty(glob(data_dir . '/autoload/plug.vim'))
  silent execute '!curl -fLo '.data_dir.'/autoload/plug.vim --create-dirs  https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim'
  autocmd VimEnter * PlugInstall --sync | source $MYVIMRC
endif

" Run PlugInstall if there are missing plugins
autocmd VimEnter * if len(filter(values(g:plugs), '!isdirectory(v:val.dir)'))
  \| PlugInstall --sync | source $MYVIMRC
\| endif

call plug#begin(has('nvim') ? stdpath('data') . '/plugged' : '~/.vim/plugged')
  " Theme
  Plug 'arcticicestudio/nord-vim'

  " Status bar
  Plug 'itchyny/lightline.vim'
  Plug 'itchyny/vim-gitbranch'

  " A collection of language packs for Vim.
  Plug 'sheerun/vim-polyglot'

  " git line information
  Plug 'airblade/vim-gitgutter'

  " formatter, fall back if lsp fails
  Plug 'sbdchd/neoformat'

  " test runner
  Plug 'vim-test/vim-test'

  " unicode inserion helper
  Plug 'chrisbra/unicode.vim'

  " A painless, powerful Vim auto-pair plugin.
  " Plug 'tmsvg/pear-tree'

  " editor config support
  Plug 'editorconfig/editorconfig-vim'

  " emmet support
  " Plug 'mattn/emmet-vim'

  " indentation guides
  " Plug 'nathanaelkane/vim-indent-guides'
  
  " Fugitive is the premier Vim plugin for Git.
  Plug 'tpope/vim-fugitive'

  " Comment stuff out.
  Plug 'tpope/vim-commentary'

  " Surround.vim is all about "surroundings": parentheses, brackets, quotes, XML tags, and more.
  Plug 'tpope/vim-surround'

  " Collection of ][ helper mappings
  Plug 'tpope/vim-unimpaired'
  
  " rust support
  " Plug 'rust-lang/rust.vim'

  if has('nvim')
    " nvim lsp configuration helper
    Plug 'neovim/nvim-lspconfig'
    Plug 'nvim-lua/lsp_extensions.nvim'

    " completion
    Plug 'hrsh7th/cmp-nvim-lsp'
    Plug 'hrsh7th/cmp-buffer'
    Plug 'hrsh7th/nvim-cmp'

    " snippets
    " Plug 'hrsh7th/cmp-vsnip'
    " Plug 'hrsh7th/vim-vsnip'
    Plug 'L3MON4D3/LuaSnip'
    Plug 'rafamadriz/friendly-snippets'
    
    " debugger protocol support
    Plug 'mfussenegger/nvim-dap'

    " telescope, file finder
    Plug 'nvim-lua/plenary.nvim'
    Plug 'nvim-telescope/telescope.nvim'
    Plug 'nvim-telescope/telescope-fzf-native.nvim', { 'do': 'make' }

    " nvim tree sitter
    Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}
    Plug 'nvim-treesitter/completion-treesitter'
  endif

  if !has('nvim')
    " file finder for regular vim
    Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }
    Plug 'junegunn/fzf.vim'
  endif
call plug#end()

" narcticicestudio/nord-vim
colorscheme nord

lua require 'eratio'

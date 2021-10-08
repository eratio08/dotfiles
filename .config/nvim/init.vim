" Maintainer: Eike Lurz <moin@elurz.de>

" For further configs check '~/.vim/plugin/'

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
  Plug 'arcticicestudio/nord-vim'
  Plug 'itchyny/lightline.vim'
  Plug 'sheerun/vim-polyglot'
  Plug 'itchyny/vim-gitbranch'
  Plug 'airblade/vim-gitgutter'
  Plug 'tpope/vim-fugitive'
  Plug 'szw/vim-maximizer'
  Plug 'kassio/neoterm'
  Plug 'sbdchd/neoformat'
  Plug 'vim-test/vim-test'
  Plug 'chrisbra/unicode.vim'
  "  " Plug 'jiangmiao/auto-pairs'
  " Plug 'townk/vim-autoclose'
  Plug 'tmsvg/pear-tree'
  Plug 'editorconfig/editorconfig-vim'
  " Plug 'mattn/emmet-vim'
  " Plug 'nathanaelkane/vim-indent-guides'
  Plug 'tpope/vim-commentary'
  Plug 'tpope/vim-surround'
  " Plug ' tpope/vim-unimpaired'
  " Plug 'rust-lang/rust.vim'
  if has('nvim')
    Plug 'neovim/nvim-lspconfig'
    Plug 'nvim-lua/lsp_extensions.nvim'
    " Plug 'nvim-lua/completion-nvim'
    Plug 'hrsh7th/cmp-nvim-lsp'
    Plug 'hrsh7th/cmp-buffer'
    Plug 'hrsh7th/nvim-cmp'
    " Plug 'hrsh7th/cmp-vsnip'
    " Plug 'hrsh7th/vim-vsnip'
    Plug 'mfussenegger/nvim-dap'
    Plug 'nvim-lua/plenary.nvim'
    Plug 'nvim-telescope/telescope.nvim'
    Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}
    Plug 'nvim-treesitter/completion-treesitter'
    Plug 'nvim-telescope/telescope-fzf-native.nvim', { 'do': 'make' }
  endif
  if !has('nvim')
    Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }
    Plug 'junegunn/fzf.vim'
  endif
call plug#end()

" narcticicestudio/nord-vim
colorscheme nord

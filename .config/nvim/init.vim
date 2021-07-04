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

call plug#begin('~/.vim/plugged')
  Plug 'arcticicestudio/nord-vim'
  Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }
  Plug 'junegunn/fzf.vim'
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
  Plug 'jiangmiao/auto-pairs'
  Plug 'editorconfig/editorconfig-vim'
  " Plug 'mattn/emmet-vim'
  " Plug 'nathanaelkane/vim-indent-guides'
  Plug 'tpope/vim-commentary'
  " Plug 'tpope/vim-surround'
  " Plug ' tpope/vim-unimpaired'
  " Plug 'rust-lang/rust.vim'
  if has('nvim')
    Plug 'neovim/nvim-lspconfig'
    Plug 'nvim-lua/lsp_extensions.nvim'
    Plug 'nvim-lua/completion-nvim'
    Plug 'mfussenegger/nvim-dap'
  endif
call plug#end()

" narcticicestudio/nord-vim
colorscheme nord

-- Maintainer: Eike Lurz <moin@elurz.de>

-- the vim ceremony
require('eratio.settings')
require('eratio.mappings')
require('eratio.netrw')

-- lsp stuff
require('eratio.nvim-lsp')
require('eratio.nvim-cmp')

-- fallback formatter
require('eratio.neoformat')

-- file finder
require('eratio.telescope')

-- status bar
require('eratio.lightline')

-- git
require('eratio.vim-fugitive')

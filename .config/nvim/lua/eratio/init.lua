-- Maintainer: Eike Lurz <moin@elurz.de>

-- the vim ceremony
require('eratio.settings')
require('eratio.mappings')
require('eratio.netrw')

-- load extensions
require('eratio.tbl-ext')

-- lsp stuff
require('eratio.nvim-lsp')
require('eratio.nvim-cmp')

-- snippets
require('eratio.friendly-snippets')

-- fallback formatter
require('eratio.neoformat')

-- file finder
require('eratio.telescope')
require('eratio.telescope-helpers')

-- status bar
require('eratio.lightline')

-- git
require('eratio.vim-fugitive')

-- testing
require('eratio.vim-test')

-- debugger
require('eratio.nvim-dap')

-- rust
require('eratio.rust-vim')

print('...done loading the "eratio" configuration.')

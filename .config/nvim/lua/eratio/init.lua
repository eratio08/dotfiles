-- Maintainer: Eike Lurz <moin@elurz.de>
-- the vim ceremony
require('eratio.settings')
require('eratio.mappings')
require('eratio.netrw')

-- table extensions
require('eratio.tbl-ext')

-- lsp stuff
require('eratio.nvim-lsp')
require('eratio.nvim-lsp-installer')
require('eratio.lsp-extensions')

-- completion
require('eratio.nvim-cmp')

-- snippets
require('eratio.friendly-snippets')

-- treesitter
require('eratio.nvim-treesitter')

-- fallback formatter
require('eratio.neoformat')

-- file finder
require('eratio.telescope')
require('eratio.telescope-helpers')
require('nvim-web-devicons')

-- status bar
require('eratio.lightline')
require('eratio.lualine')

-- git
require('eratio.vim-fugitive')

-- testing
require('eratio.vim-test')

-- debugger
require('eratio.nvim-dap')

-- rust
require('eratio.rust-vim')

-- lua formatting
require('eratio.stylua')

-- comment
require('eratio.comment-nvim')

print('...done loading the "eratio" config.')

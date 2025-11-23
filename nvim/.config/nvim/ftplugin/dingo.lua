vim.treesitter.language.register('go', 'dingo')
vim.treesitter.start(0, 'go')
vim.lsp.enable('dingo-lsp')

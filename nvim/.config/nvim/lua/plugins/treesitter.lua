return {
  enabled = true,
  'nvim-treesitter/nvim-treesitter',
  branch = 'main',
  commit = 'faf63903ffa05a9dadd56258d737a0243393c0f5',
  lazy = false,
  build = ':TSUpdate',
  dependencies = {
    -- 'nvim-treesitter/nvim-treesitter-textobjects',
    -- 'nvim-treesitter/nvim-treesitter-refactor',
  },
  config = function ()
    local ts = require('nvim-treesitter')
    ts.setup({
      install_dir = vim.fn.stdpath('data') .. '/site',
    })

    vim.api.nvim_create_autocmd('FileType', {
      pattern = require('nvim-treesitter').get_available(),
      callback = function (ev)
        if not vim.list_contains(ts.get_installed(), ev.match) then
          print('Running "TSInstall ' .. ev.match .. '"')
          ts.install({ ev.match })
          print('Installed grammer for "' .. ev.match .. '"')
        end

        vim.treesitter.start()
        vim.wo.foldexpr = 'v:lua.vim.treesitter.foldexpr()'
        vim.bo.indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
      end,
    })

    -- require('nvim-treesitter.parsers').roc = {
    --   install_info = {
    --     url = 'https://github.com/faldor20/tree-sitter-roc',
    --     files = { 'src/parser.c', 'src/scanner.c' },
    --   },
    -- }
  end
}

return {
  enabled = true,
  'nvim-treesitter/nvim-treesitter',
  branch = 'main',
  lazy = false,
  build = ':TSUpdate',
  dependencies = {
    { 'nvim-treesitter/nvim-treesitter-textobjects', branch = 'main' },
    -- 'nvim-treesitter/nvim-treesitter-refactor',
    'folke/which-key.nvim',
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
          ts.install({ ev.match }):wait(300000) -- wait max 5min
          print('Installed grammer for "' .. ev.match .. '"')
        end

        vim.treesitter.start(ev.buf, ev.match)
        vim.wo.foldexpr = 'v:lua.vim.treesitter.foldexpr()'
        vim.bo.indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
        vim.bo.syntax = 'on'
      end,
    })

    -- require('nvim-treesitter.parsers').roc = {
    --   install_info = {
    --     url = 'https://github.com/faldor20/tree-sitter-roc',
    --     files = { 'src/parser.c', 'src/scanner.c' },
    --   },
    -- }

    require('nvim-treesitter-textobjects').setup {
      select = {
        lookahead = true,
        selection_modes = {
          ['@parameter.outer'] = 'v', -- charwise
          ['@function.outer'] = 'V',  -- linewise
          ['@class.outer'] = '<c-v>', -- blockwise
        },
        include_surrounding_whitespace = false,
      },
    }

    local to = require('nvim-treesitter-textobjects.select')
    require('which-key').add({
      { 'af', function () to.select_textobject('@function.outer', 'textobjects') end, desc = 'Around function', mode = { 'x', 'o' } },
      { 'if', function () to.select_textobject('@function.inner', 'textobjects') end, desc = 'In function', mode = { 'x', 'o' } },
      { 'ac', function () to.select_textobject('@class.outer', 'textobjects') end, desc = 'Around class', mode = { 'x', 'o' } },
      { 'ic', function () to.select_textobject('@class.inner', 'textobjects') end, desc = 'In class', mode = { 'x', 'o' } },
      { 'as', function () to.select_textobject('@local.scope', 'locals') end, desc = 'Around scope', mode = { 'x', 'o' } },
      { 'ab', function () to.select_textobject('@block.outer', 'textobjects') end, desc = 'Around block', mode = { 'x', 'o' } },
      { 'ib', function () to.select_textobject('@block.inner', 'textobjects') end, desc = 'In block', mode = { 'x', 'o' } },
    })
  end
}

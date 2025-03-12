return {
  enabled = true,
  'nvim-treesitter/nvim-treesitter',
  event = 'VeryLazy',
  build = ':TSUpdate',
  dependencies = {
    -- 'nvim-treesitter/nvim-treesitter-textobjects',
    -- 'nvim-treesitter/nvim-treesitter-refactor',
  },
  config = function ()
    require('nvim-treesitter.configs').setup({
      ensure_installed = {
        'vim',
        'regex',
        'lua',
      },
      modules = {},
      sync_install = false,
      auto_install = true,
      ignore_install = {},
      highlight = {
        enable = true,
        disable = function (_, buf)
          local max_filesize = 100 * 1024 -- 100 KB
          local ok, stats = pcall(vim.uv.fs_stat, vim.api.nvim_buf_get_name(buf))
          if ok and stats and stats.size > max_filesize then
            print('Large file detected, disabeling treesitter highlighting (' ..
              stats.size / 1024 .. 'KB > ' .. max_filesize / 1024 .. 'KB).')
            return true
          end
        end,
        additional_vim_regex_highlighting = false,
      },
      indent = {
        enable = true,
      },
      -- refactor = {
      --   highlight_definitions = {
      --     enable = true,
      --     clear_on_cursor_move = true,
      --   },
      -- },
      -- textobjects = {
      -- swap = {
      --   enable = true,
      --   swap_next = {
      --     ['<A-j>'] = '@parameter.inner',
      --   },
      --   swap_previous = {
      --     ['<A-k>'] = '@parameter.inner',
      --   },
      -- },
      -- select = {
      --   enable = true,
      --   lookahead = true,
      --   keymaps = {
      --     ['af'] = '@function.outer',
      --     ['if'] = '@function.inner',
      --     ['ac'] = '@class.outer',
      --     ['ic'] = { query = '@class.inner', desc = 'Select inner part of a class region' },
      --     ['as'] = { query = '@scope', query_group = 'locals', desc = 'Select language scope' },
      --   },
      --   selection_modes = {
      --     ['@parameter.outer'] = 'v', -- charwise
      --     ['@function.outer'] = 'V',  -- linewise
      --     ['@class.outer'] = '<c-v>', -- blockwise
      --   },
      --   include_surrounding_whitespace = false,
      -- },
      -- move = {
      --   enable = true,
      --   set_jumps = true,
      --   goto_next_start = {
      --     [']m'] = '@function.outer',
      --     [']]'] = { query = '@class.outer', desc = 'Next class start' },
      --     [']o'] = '@loop.*',
      --     -- ["]o"] = { query = { "@loop.inner", "@loop.outer" } }
      --     [']s'] = { query = '@scope', query_group = 'locals', desc = 'Next scope' },
      --     [']z'] = { query = '@fold', query_group = 'folds', desc = 'Next fold' },
      --   },
      --   goto_next_end = {
      --     [']M'] = '@function.outer',
      --     [']['] = '@class.outer',
      --   },
      --   goto_previous_start = {
      --     ['[m'] = '@function.outer',
      --     ['[['] = '@class.outer',
      --     ['[s'] = { query = '@scope', query_group = 'locals', desc = 'Previous scope' },
      --     ['[z'] = { query = '@fold', query_group = 'folds', desc = 'Previous fold' },
      --   },
      --   goto_previous_end = {
      --     ['[M'] = '@function.outer',
      --     ['[]'] = '@class.outer',
      --   },
      --   goto_next = {
      --     [']d'] = '@conditional.outer',
      --   },
      --   goto_previous = {
      --     ['[d'] = '@conditional.outer',
      --   }
      -- }
      -- },
      playground = {
        enable = true,
        disable = {},
        updatetime = 25,         -- Debounced time for highlighting nodes in the playground from source code
        persist_queries = false, -- Whether the query persists across vim sessions
        keybindings = {
          toggle_query_editor = 'o',
          toggle_hl_groups = 'i',
          toggle_injected_languages = 't',
          toggle_anonymous_nodes = 'a',
          toggle_language_display = 'I',
          focus_language = 'f',
          unfocus_language = 'F',
          update = 'R',
          goto_node = '<cr>',
          show_help = '?',
        },
      }
    })

    require('nvim-treesitter.parsers').get_parser_configs().roc = {
      install_info = {
        url = 'https://github.com/faldor20/tree-sitter-roc',
        files = { 'src/parser.c', 'src/scanner.c' },
      },
    }
  end
}

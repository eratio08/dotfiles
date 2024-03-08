return {
  'nvim-telescope/telescope.nvim',
  tag = '0.1.5',
  keys = { { '<leader>f', mode = { 'n', 'v' } } },
  dependencies = {
    'nvim-lua/plenary.nvim',
    {
      'nvim-telescope/telescope-ui-select.nvim',
      config = function () require('telescope').load_extension('ui-select') end
    },
    {
      'nvim-telescope/telescope-fzf-native.nvim',
      build  = 'make',
      config = function () require('telescope').load_extension('fzf') end
    },
    {
      'nvim-telescope/telescope-file-browser.nvim',
      config = function () require('telescope').load_extension('file_browser') end
    },
    'folke/which-key.nvim',
  },
  config = function ()
    local telescope = require('telescope')
    local builtin = require('telescope.builtin')
    -- local themes = require('telescope.themes')
    local actions = require('telescope.actions')
    local wk = require('which-key')
    local is_git_repo = os.execute('git rev-parse --is-inside-work-tree > /dev/null 2>&1') == 0

    wk.register({
      ['<leader>f'] = {
        name = 'Find',
        f = { function () if is_git_repo then builtin.git_files() else builtin.find_files() end end, 'Git/Files' },
        F = { builtin.find_files, 'Files' },
        w = { builtin.grep_string, 'Word', mode = { 'n', 'v' } },
        W = { function () builtin.grep_string({ search = vim.fn.expand('<cWORD>') }) end, 'WORD' },
        g = { builtin.live_grep, 'Grep' },
        ['.'] = { function () builtin.live_grep({ search_dirs = { vim.fn.expand('%:p:h') } }) end, 'Grep .' },
        e = { function () telescope.extensions.file_browser.file_browser({ path = '%:p:h' }) end, 'Explorer' },
        p = { function () telescope.extensions.file_browser.file_browser({ path = 'pwd' }) end, 'Project' },
        b = { builtin.buffers, 'Buffers' },
        d = { builtin.diagnostics, 'Diagnostics' },
        S = { builtin.spell_suggest, 'Spell Suggestions' },
        t = { builtin.treesitter, 'Treesitter' },
        q = { builtin.quickfix, 'Quickfixes' },
        Q = { builtin.quickfixhistory, 'Quickfix History' },
        C = { function () builtin.lsp_dynamic_workspace_symbols({ symbols = { 'class', 'struct', 'interface' } }) end, 'Classes' },
        l = { builtin.loclist, 'Location List' },
        h = { builtin.help_tags, 'Help Tags' },
        H = { builtin.search_history, 'Search History' },
        m = { builtin.man_pages, 'Man Pages' },
        c = { builtin.colorscheme, 'Color Schemes' },
        r = { builtin.registers, 'Registers' },
        j = { builtin.jumplist, 'Jump List' },
        ['?'] = { builtin.oldfiles, 'Recently opened files' },
        ['/'] = { builtin.current_buffer_fuzzy_find, 'Current Buffer' },
        [','] = { function ()
          builtin.find_files({
            prompt_title = 'NVim Settings',
            cwd = '~/.config/nvim',
          })
        end, 'Settings' },
        V = {
          name = 'Vim',
          o = { builtin.vim_options, 'Options' },
          c = { builtin.commands, 'Commands' },
          k = { builtin.keymaps, 'Key Maps' },
          r = { builtin.reloader, 'Reloader' },
          f = { builtin.filetypes, 'Filetypes' },
          H = { builtin.highlights, 'Highlights' },
          a = { builtin.autocommands, 'Autocommands' },
        },
        G = {
          name = 'Git',
          f = { builtin.git_files, 'Files' },
          c = { builtin.git_commits, 'Commits' },
          b = { builtin.git_branches, 'Branches' },
          s = { builtin.git_stash, 'Stashes' },
          h = { builtin.git_bcommits, 'Buffer History' },
          S = { builtin.git_status, 'Status' },
        },
        T = {
          name = 'Telescope',
          b = { builtin.builtin, 'Builtins' },
          p = { builtin.pickers, 'Pickers' },
        },
        o = { builtin.resume, 'Resume' },
        L = {
          name = 'LSP',
          r = { builtin.lsp_references, 'References' },
          i = { builtin.lsp_implementations, 'Implementation' },
          I = { builtin.lsp_incoming_calls, 'Incoming Calls' },
          O = { builtin.lsp_outgoing_calls, 'Outgoing Calls' },
          d = { builtin.lsp_definitions, 'Definitions' },
          D = { builtin.lsp_document_symbols, 'Document Symbols' },
          t = { builtin.lsp_type_definitions, 'Type Definitions' },
          w = { builtin.lsp_workspace_symbols, 'Workspace Symbols' },
          W = { builtin.lsp_dynamic_workspace_symbols, 'Dynamic Workspace Symbols' },
        },
      },
    })

    telescope.setup({
      defaults = {
        prompt_prefix = '> ',
        color_devicons = true,
        mappings = {
          i = {
            ['<C-u>'] = false,
            ['<C-d>'] = false,
            ['<Tab>'] = actions.move_selection_previous,
            ['<S-Tab>'] = actions.move_selection_next,
            ['<C-CR>'] = function (bufnr)
              actions.toggle_selection(bufnr)
              actions.move_selection_previous(bufnr)
            end,
            ['<C-n>'] = function (bufnr)
              actions.toggle_selection(bufnr)
              actions.move_selection_previous(bufnr)
            end,
            ['<C-p>'] = function (bufnr)
              actions.toggle_selection(bufnr)
              actions.move_selection_next(bufnr)
            end,
            ['<C-k>'] = actions.move_selection_previous,
            ['<C-j>'] = actions.move_selection_next,
            ['<C-q>'] = actions.send_selected_to_qflist + actions.open_qflist,
            ['<C-x>'] = actions.delete_buffer,
          },
        },
        file_ignore_patterns = {
          'node_modules',
          '.git',
          '_build',
        },
        hidden = true,
      },
      pickers = {
        live_grep = {
          prompt_title = 'Grep',
          -- theme = 'dropdown',
        },
        buffers = {
          prompt_title = 'Buffers',
          theme = 'dropdown',
        },
        diagnostics = {
          prompt_title = 'Diagnostics',
          theme = 'dropdown',
        },
        find_files = {
          prompt_title = 'Files',
          hidden = true,
        },
        grep_string = {
          -- theme = 'dropdown',
        },
        current_buffer_fuzzy_find = {
          theme = 'dropdown',
          previewer = false,
        },
        oldfiles = {
          theme = 'dropdown',
        },
        jumplist = {
          theme = 'dropdown',
        },
        colorscheme = {
          theme = 'dropdown',
          enable_preview = true,
        },
        registers = {
          theme = 'dropdown',
          layout_config = {
            height = 0.75,
          }
        },
      },
      extensions = {
        fzf = {
          fuzzy = true,
          override_generic_sorter = true,
          override_file_sorter = true,
          case_mode = 'smart_case',
        },
        file_browser = {
          theme = 'dropdown',
        }
      },
    })
  end
}

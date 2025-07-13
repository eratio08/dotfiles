return {
  'nvim-telescope/telescope.nvim',
  branch = 'master',
  keys = { { '<leader>f', desc = 'Find', mode = { 'n', 'v' } } },
  dependencies = {
    'nvim-lua/plenary.nvim',
    {
      'nvim-telescope/telescope-fzf-native.nvim',
      build  = 'make',
      config = function () require('telescope').load_extension('fzf') end
    },
    'folke/which-key.nvim',
  },
  config = function ()
    local telescope = require('telescope')
    local builtin = require('telescope.builtin')
    local actions = require('telescope.actions')
    local wk = require('which-key')
    local is_git_repo = os.execute('git rev-parse --is-inside-work-tree > /dev/null 2>&1') == 0

    wk.add({
      { '<leader>f', group = 'Find' },
      { '<leader>ff', builtin.find_files, desc = 'Find Files' },
      { '<leader>fF', function () if is_git_repo then builtin.git_files() else builtin.find_files() end end, desc = 'Find Git/Files' },
      { '<leader>fw', builtin.grep_string, desc = 'Find Word', mode = { 'n', 'v' } },
      { '<leader>fW', function () builtin.grep_string({ search = vim.fn.expand('<cWORD>') }) end, desc = 'Find WORD' },
      { '<leader>fg', builtin.live_grep, desc = 'Grep' },
      { '<leader>f.', function () builtin.live_grep({ search_dirs = { vim.fn.expand('%:p:h') } }) end, desc = 'Grep .' },
      -- { '<leader>fe', function () telescope.extensions.file_browser.file_browser({ path = '%:p:h' }) end, desc = 'Find Explorer' },
      -- { '<leader>fp', function () telescope.extensions.file_browser.file_browser({ path = 'pwd' }) end, desc = 'Find Project' },
      { '<leader>fb', builtin.buffers, desc = 'Find Buffers' },
      { '<leader>fd', builtin.diagnostics, desc = 'Diagnostics' },
      { '<leader>fz', builtin.spell_suggest, desc = 'Spell Suggestions' },
      { '<leader>ft', builtin.treesitter, desc = 'Treesitter' },
      { '<leader>fq', builtin.quickfix, desc = 'Quickfixes' },
      { '<leader>fQ', builtin.quickfixhistory, desc = 'Quickfix History' },
      { '<leader>fC', function () builtin.lsp_dynamic_workspace_symbols({ symbols = { 'class', 'struct', 'interface' } }) end, desc = 'Classes' },
      { '<leader>fl', builtin.loclist, desc = 'Location List' },
      { '<leader>fh', builtin.help_tags, desc = 'Help Tags' },
      { '<leader>fH', builtin.search_history, desc = 'Search History' },
      { '<leader>fm', builtin.man_pages, desc = 'Man Pages' },
      { '<leader>fc', builtin.colorscheme, desc = 'Color Schemes' },
      { '<leader>fr', builtin.registers, desc = 'Registers' },
      { '<leader>fj', builtin.jumplist, desc = 'Jump List' },
      { '<leader>f?', builtin.oldfiles, desc = 'Recently opened files' },
      { '<leader>f/', builtin.current_buffer_fuzzy_find, desc = 'Current Buffer' },
      { '<leader>fo', builtin.resume, desc = 'Resume Find' },
      { '<leader>f,', function () builtin.find_files({ prompt_title = 'NVim Settings', cwd = '~/.config/nvim', }) end, desc = 'Vim Settings' },
      -- Vim
      { '<leader>fV', group = 'Vim' },
      { '<leader>fVo', builtin.vim_options, desc = 'Vim Options' },
      { '<leader>fVc', builtin.commands, desc = 'Vim Commands' },
      { '<leader>fVk', builtin.keymaps, desc = 'Vim Key Maps' },
      { '<leader>fVr', builtin.reloader, desc = 'Vim Reloader' },
      { '<leader>fVf', builtin.filetypes, desc = 'Vim Filetypes' },
      { '<leader>fVH', builtin.highlights, desc = 'Vim Highlights' },
      { '<leader>fVa', builtin.autocommands, desc = 'Vim Autocommands' },
      -- Git
      { '<leader>fG', group = 'Git' },
      { '<leader>fGf', builtin.git_files, desc = 'Git Files' },
      { '<leader>fGc', builtin.git_commits, desc = 'Git Commits' },
      { '<leader>fGb', builtin.git_branches, desc = 'Git Branches' },
      { '<leader>fGs', builtin.git_stash, desc = 'Git Stashes' },
      { '<leader>fGh', builtin.git_bcommits, desc = 'Git Buffer History' },
      { '<leader>fGS', builtin.git_status, desc = 'Git Status' },
      -- Telescope
      { '<leader>fT', group = 'Telescope' },
      { '<leader>fTb', builtin.builtin, desc = 'Telescope Builtins' },
      { '<leader>fTp', builtin.pickers, desc = 'Telescope Pickers' },
      -- LSP
      { '<leader>fL', group = 'LSP' },
      { '<leader>fLr', builtin.lsp_references, desc = 'References' },
      { '<leader>fLi', builtin.lsp_implementations, desc = 'Implementation' },
      { '<leader>fLI', builtin.lsp_incoming_calls, desc = 'Incoming Calls' },
      { '<leader>fLO', builtin.lsp_outgoing_calls, desc = 'Outgoing Calls' },
      { '<leader>fLd', builtin.lsp_definitions, desc = 'Definitions' },
      { '<leader>fLD', builtin.lsp_document_symbols, desc = 'Document Symbols' },
      { '<leader>fLt', builtin.lsp_type_definitions, desc = 'Type Definitions' },
      { '<leader>fLw', builtin.lsp_workspace_symbols, desc = 'Workspace Symbols' },
      { '<leader>fLW', builtin.lsp_dynamic_workspace_symbols, desc = 'Dynamic Workspace Symbols' },
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
          'dune.lock',
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
      },
    })
  end
}

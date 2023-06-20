local builtin = require('telescope.builtin')
local wk = require('which-key')
local telescope = require('telescope')

wk.register({
  ['<leader>f'] = {
    name = 'Find',
    f = { builtin.find_files, 'Files' },
    g = { builtin.live_grep, 'Grep' },
    e = { function () telescope.extensions.file_browser.file_browser({ path = '%:p:h' }) end, 'Explorer' },
    b = { builtin.buffers, 'Buffers' },
    d = { builtin.diagnostics, 'Diagnostics' },
    s = { function () builtin.grep_string({ search = vim.fn.input('Grep > ') }) end, 'String' },
    S = { builtin.spell_suggest, 'Spell Suggestions' },
    t = { builtin.treesitter, 'Treesitter' },
    q = { builtin.quickfix, 'Quickfixes' },
    Q = { builtin.quickfixhistory, 'Quickfix History' },
    l = { builtin.loclist, 'Location List' },
    h = { builtin.search_history, 'Search History' },
    m = { builtin.man_pages, 'Man Pages' },
    c = { builtin.colorscheme, 'Color Schemes' },
    r = { builtin.registers, 'Registers' },
    j = { builtin.jumplist, 'Jump List' },
    ['?'] = { builtin.oldfiles, 'Recently opened files' },
    ['/'] = { function ()
      builtin.current_buffer_fuzzy_find(require('telescope.themes')
        .get_dropdown({
          winblend = 10,
          previewer = false
        }))
    end, 'Current Buffer' },
    [','] = { function ()
      builtin.find_files({
        prompt_title = '<NVim Settings>',
        cwd = '~/.config/nvim',
      })
    end, 'Settings' },
    V = {
      name = 'Vim',
      o = { builtin.vim_options, 'Options' },
      c = { builtin.commands, 'Commands' },
      k = { builtin.keymaps, 'Key Maps' },
      h = { builtin.help_tags, 'Help Tags' },
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
    R = { builtin.resume, 'Resume' },
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
    },
  }
})

local telescope_actions = require('telescope.actions')

telescope.setup({
  defaults = {
    prompt_prefix = '> ',
    color_devicons = true,
    mappings = {
      i = {
        ['<C-u>'] = false,
        ['<C-d>'] = false,
        ['<Tab>'] = telescope_actions.move_selection_next,
        ['<S-Tab>'] = telescope_actions.move_selection_previous,
        ['<C-CR>'] = function (bufnr)
          telescope_actions.toggle_selection(bufnr)
          telescope_actions.move_selection_previous(bufnr)
        end,
        ['<C-n>'] = function (bufnr)
          telescope_actions.toggle_selection(bufnr)
          telescope_actions.move_selection_previous(bufnr)
        end,
        ['<C-p>'] = function (bufnr)
          telescope_actions.toggle_selection(bufnr)
          telescope_actions.move_selection_next(bufnr)
        end
      },
    },
  },
  pickers = {
    live_grep = {
      prompt_title = 'Live Grep',
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
      prompt_title = 'Find Files',
      hidden = true,
    }
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
    },
    ['ui-select'] = {
      require('telescope.themes').get_dropdown(),
    },
  },
})

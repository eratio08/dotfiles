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
    v = {
      name = 'Vim',
      o = { builtin.vim_options, 'Options' },
      c = { builtin.commands, 'Commands' },
      k = { builtin.keymaps, 'Key Maps' },
      h = { builtin.help_tags, 'Help Tags' },
    }
  }
})

telescope.setup({
  defaults = {
    prompt_prefix = '> ',
    color_devicons = true,
    mappings = {
      i = {
        ['<C-u>'] = false,
        ['<C-d>'] = false,
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

local builtin = require('telescope.builtin')
local wk = require("which-key")

wk.register({
  ['<leader>f'] = {
    name = "Find",
    f = { builtin.find_files, 'Files' },
    g = { builtin.live_grep, 'Grep' },
    b = { builtin.buffers, 'Buffers' },
    d = { builtin.diagnostics, 'Diagnostics' },
    s = { function() builtin.grep_string({ search = vim.fn.input("Grep > ") }) end, 'String' },
    ['?'] = { builtin.oldfiles, 'Recently opened files' },
    ['/'] = { function()
      builtin.current_buffer_fuzzy_find(require('telescope.themes')
        .get_dropdown({
          winblend = 10,
          previewer = false
        }))
    end, 'Current Buffer' },
    [','] = { function()
      builtin.find_files({
        prompt_title = '<NVim Settings>',
        cwd = '~/.config/nvim',
      })
    end, 'Settings' },
    v = {
      name = "Vim",
      o = { builtin.vim_options, 'Options' },
      c = { builtin.commands, 'Commands' },
      k = { builtin.keymaps, 'Key Maps' },
      h = { builtin.help_tags, 'Help Tags' },
    }
  }
})

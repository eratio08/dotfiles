return {
  enabled = true,
  'saghen/blink.cmp',
  dependencies = {
    'rafamadriz/friendly-snippets',
    'moyiz/blink-emoji.nvim',
    -- 'MahanRahmati/blink-nerdfont.nvim',
  },
  version = '*',
  ---@module 'blink.cmp'
  ---@type blink.cmp.Config
  opts = {
    keymap = {
      preset = 'default',
      ['<C-space>'] = { 'show', 'show_documentation', 'hide_documentation' },
      ['<C-e>'] = { 'hide', 'fallback' },
      ['<Tab>'] = { 'select_next', 'snippet_forward', 'fallback' },
      ['<S-Tab>'] = { 'select_prev', 'snippet_backward', 'fallback' },
      ['<CR>'] = { 'accept', 'fallback' },
      ['<Up>'] = { 'select_prev', 'fallback' },
      ['<Down>'] = { 'select_next', 'fallback' },
      ['<C-p>'] = { 'select_prev', 'fallback' },
      ['<C-n>'] = { 'select_next', 'fallback' },
      ['<C-u>'] = { 'scroll_documentation_up', 'fallback' },
      ['<C-d>'] = { 'scroll_documentation_down', 'fallback' },
    },
    sources = {
      default = { 'lazydev', 'lsp', 'path', 'snippets', 'buffer', 'emoji' },
      providers = {
        emoji = {
          module = 'blink-emoji',
          name = 'Emoji',
          score_offset = 15,
          should_show_items = function ()
            return vim.tbl_contains({ 'gitcommit', 'markdown' }, vim.o.filetype)
          end,
        },
        lazydev = {
          name = 'LazyDev',
          module = 'lazydev.integrations.blink',
          score_offset = 100,
        },
      }
    },
    signature = { enabled = true },
    completion = {
      menu = {
        auto_show = function (ctx)
          local is_cmdline = ctx.mode == 'cmdline'
          local is_search = vim.tbl_contains({ '/', '?' }, vim.fn.getcmdtype())
          local is_fugitive = not not ctx.line:match('^G .*')
          return not (is_cmdline and (is_search or is_fugitive))
        end,
      },
      list = {
        selection = {
          preselect = function (ctx) return ctx.mode ~= 'cmdline' end,
          auto_insert = function (ctx) return ctx.mode ~= 'cmdline' end
        },
      },
    },
  },
}

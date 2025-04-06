return {
  enabled = true,
  'saghen/blink.cmp',
  dependencies = {
    'nvim-tree/nvim-web-devicons',
    'onsails/lspkind-nvim',

    -- Snippets
    'rafamadriz/friendly-snippets',
    -- { 'L3MON4D3/LuaSnip', version = 'v2.*' },

    -- Sources
    'moyiz/blink-emoji.nvim',
    'folke/lazydev.nvim',
    'fang2hou/blink-copilot',
    'giuxtaposition/blink-cmp-copilot',
    'Kaiser-Yang/blink-cmp-git',
    'ribru17/blink-cmp-spell',
    'kristijanhusak/vim-dadbod-completion',
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
    -- snippets = { preset = 'luasnip' },
    sources = {
      default = {
        'lsp',
        'path',
        'snippets',
        'buffer',
        'emoji',
        -- 'omni',
      },
      per_filetype = {
        markdown = { 'lsp', 'path', 'buffer', 'emoji' },
        -- codecompanion = { 'codecompanion' },
        lua = { 'lazydev', 'lsp', 'path', 'snippets', 'buffer', 'emoji' },
        sql = { 'dadbod', 'buffer' },
      },
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
        dadbod = { name = 'Dadbod', module = 'vim_dadbod_completion.blink' },
      }
    },
    signature = { enabled = true },
    completion = {
      menu = {
        auto_show = function (ctx)
          local is_cmdline = ctx.mode == 'cmdline'
          local is_search = vim.tbl_contains({ '/', '?' }, vim.fn.getcmdtype())
          local is_fugitive = not not ctx.line:match('^G .*')
          local is_copilot_chat = vim.bo.filetype == 'copilot-chat'
          return (not (is_cmdline and (is_search or is_fugitive))) and (not is_copilot_chat)
        end,
        draw = {
          treesitter = { 'lsp' },
          columns = {
            { 'kind_icon' },
            { 'label', 'label_description', gap = 1 },
          },
          components = {
            kind_icon = {
              text = function (ctx)
                local icon = ctx.kind_icon
                if vim.tbl_contains({ 'Path' }, ctx.source_name) then
                  local dev_icon, _ = require('nvim-web-devicons').get_icon(ctx.label)
                  if dev_icon then
                    icon = dev_icon
                  end
                else
                  icon = require('lspkind').symbolic(ctx.kind, {
                    mode = 'symbol',
                  })
                end
                return icon .. ctx.icon_gap
              end,
              highlight = function (ctx)
                local hl = ctx.kind_hl
                if vim.tbl_contains({ 'Path' }, ctx.source_name) then
                  local dev_icon, dev_hl = require('nvim-web-devicons').get_icon(ctx.label)
                  if dev_icon then
                    hl = dev_hl
                  end
                end
                return hl
              end,
            }
          }
        },
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

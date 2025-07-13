return {
  enabled = true,
  'saghen/blink.cmp',
  dependencies = {
    'nvim-tree/nvim-web-devicons',
    'onsails/lspkind-nvim',

    -- Snippets
    'rafamadriz/friendly-snippets',

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
      ['<CR>'] = { 'accept', 'fallback' },
      ['<Tab>'] = { 'select_next', 'snippet_forward', 'fallback' },
      ['<S-Tab>'] = { 'select_prev', 'snippet_backward', 'fallback' },
      ['<Up>'] = { 'select_prev', 'fallback' },
      ['<Down>'] = { 'select_next', 'fallback' },
      ['<C-p>'] = { 'select_prev', 'fallback' },
      ['<C-n>'] = { 'select_next', 'fallback' },
      ['<C-u>'] = { 'scroll_documentation_up', 'fallback' },
      ['<C-d>'] = { 'scroll_documentation_down', 'fallback' },
    },
    sources = {
      default = {
        'lsp',
        'path',
        'snippets',
        'buffer',
        'emoji',
        'omni',
      },
      per_filetype = {
        markdown = { 'lsp', 'path', 'buffer', 'emoji' },
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
          transform_items = function (_, items)
            for _, item in ipairs(items) do
              item.kind_icon = '󰞅'
              item.kind_name = 'emoji'
            end
            return items
          end
        },
        lazydev = {
          name = 'LazyDev',
          module = 'lazydev.integrations.blink',
          score_offset = 100,
        },
        dadbod = { name = 'Dadbod', module = 'vim_dadbod_completion.blink' },
        cmdline = {
          -- ignores cmdline completions when executing shell commands
          enabled = function ()
            return vim.fn.getcmdtype() ~= ':' or not vim.fn.getcmdline():match("^[%%0-9,'<>%-]*!")
          end
        },
        lsp = {
          name = 'LSP',
          module = 'blink.cmp.sources.lsp',
          transform_items = function (_, items)
            -- Exclude keyword from autocomplete
            return vim.tbl_filter(function (item)
              return item.kind ~= require('blink.cmp.types').CompletionItemKind.Keyword
            end, items)
          end,
        },
      }
    },
    signature = { enabled = true },
    completion = {
      menu = {
        auto_show = true,
        draw = {
          treesitter = { 'lsp' },
          columns = {
            { 'label', 'label_description', gap = 1 },
            { 'kind_icon', 'kind', gap = 1 },
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
          preselect = true,
          auto_insert = false,
        },
      },
      ghost_text = { enabled = true },
    },
    fuzzy = { implementation = 'prefer_rust_with_warning' },
  },
  opts_extend = { 'sources.default' },
}

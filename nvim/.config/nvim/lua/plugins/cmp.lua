return {
  'hrsh7th/nvim-cmp',
  event = 'InsertEnter',
  dependencies = {
    -- Autocompletion
    'hrsh7th/cmp-nvim-lsp',
    'hrsh7th/cmp-buffer',
    'hrsh7th/cmp-path',
    'hrsh7th/cmp-nvim-lua',
    'hrsh7th/cmp-emoji',
    'hrsh7th/cmp-cmdline',
    'petertriho/cmp-git',
    'ray-x/cmp-treesitter',
    'onsails/lspkind-nvim',
    'hrsh7th/cmp-nvim-lsp-signature-help',
    -- Snippets
    {
      'L3MON4D3/LuaSnip',
      dependencies = {
        'rafamadriz/friendly-snippets',
      }
    },
  },
  config = function ()
    local cmp = require('cmp')
    local luasnip = require('luasnip')
    luasnip.config.setup {}

    cmp.setup({
      snippet = {
        expand = function (args)
          require('luasnip').lsp_expand(args.body)
        end,
      },
      preselect = cmp.PreselectMode.Item,
      mapping = cmp.mapping.preset.insert({
        ['<C-u>'] = cmp.mapping.scroll_docs(-4),
        ['<C-d>'] = cmp.mapping.scroll_docs(4),
        ['<C-Space>'] = cmp.mapping.complete(),
        ['<CR>'] = cmp.mapping(function (fallback)
          if cmp.visible() then
            if luasnip.expandable() then
              luasnip.expand()
            else
              cmp.confirm({
                select = true,
                behavior = cmp.ConfirmBehavior.Replace,
              })
            end
          else
            fallback()
          end
        end),
        ['<Tab>'] = cmp.mapping(function (fallback)
          if cmp.visible() then
            cmp.select_next_item()
          elseif luasnip.locally_jumpable(1) then
            luasnip.jump(1)
          else
            fallback()
          end
        end, { 'i', 's' }),
        ['<S-Tab>'] = cmp.mapping(function (fallback)
          if cmp.visible() then
            cmp.select_prev_item()
          elseif luasnip.locally_jumpable(-1) then
            luasnip.jump(-1)
          else
            fallback()
          end
        end, { 'i', 's' }),
      }),
      -- If no match is provided by a group the next will be used.
      sources = cmp.config.sources({
        { name = 'lazydev', group_index = 0 },
        { name = 'nvim_lsp' },
        { name = 'luasnip' },
        { name = 'nvim_lsp_signature_help' },
      }, {
        { name = 'path' },
        { name = 'emoji' },
      }, {
        { name = 'treesitter' },
        { name = 'buffer' },
      }),
      formatting = {
        format = require('lspkind').cmp_format({
          mode = 'symbol_text',
          maxwidth = 50,
          menu = {
            buffer     = '',
            nvim_lsp   = '',
            nvim_lua   = '',
            path       = '',
            luasnip    = '',
            treesitter = '',
            emoji      = 'ﲃ',
            cmp_git    = '',
            cmdline    = '',
          },
        }),
      },
    })

    cmp.setup.filetype('gitcommit', {
      sources = cmp.config.sources({
        { name = 'emoji' },
      }, {
        { name = 'git' },
      }, {
        { name = 'buffer' },
      })
    })

    cmp.setup.cmdline(':', {
      mapping = cmp.mapping.preset.cmdline(),
      sources = cmp.config.sources({
        { name = 'path' }
      }, {
        {
          name = 'cmdline',
          option = {
            ignore_cmds = { 'Man', '!' }
          }
        }
      })
    })

    require('cmp_git').setup()

    -- Has to be set after setup to work
    vim.diagnostic.config({ virtual_text = true })
  end
}

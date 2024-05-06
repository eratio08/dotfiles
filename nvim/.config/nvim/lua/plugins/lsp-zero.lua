return {
  'VonHeikemen/lsp-zero.nvim',
  branch = 'v3.x',
  lazy = false,
  dependencies = {
    -- LSP Support
    'neovim/nvim-lspconfig',
    'williamboman/mason.nvim',
    'williamboman/mason-lspconfig.nvim',
    'ray-x/lsp_signature.nvim',
    'b0o/schemastore.nvim',

    -- Autocompletion
    'hrsh7th/nvim-cmp',
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
    'L3MON4D3/LuaSnip',
    'rafamadriz/friendly-snippets',

    -- key bindings
    'folke/which-key.nvim',

    -- folds
    'kevinhwang91/nvim-ufo',
  },
  config = function ()
    local lsp_zero = require('lsp-zero')

    -- for nvim-ufo
    lsp_zero.set_server_config({
      capabilities = {
        textDocument = {
          foldingRange = {
            dynamicRegistration = false,
            lineFoldingOnly = true
          }
        }
      }
    })

    lsp_zero.on_attach(function (_, bufnr)
      lsp_zero.default_keymaps({ buffer = bufnr })

      local wk = require('which-key')
      wk.register({
        K = { function ()
          local winid = require('ufo').peekFoldedLinesUnderCursor()
          if not winid then
            vim.lsp.buf.hover()
          end
        end, 'Hover Documentation' },
        g = {
          name = 'Go',
          d = { vim.lsp.buf.definition, 'Definition' },
          D = { vim.lsp.buf.declaration, 'Declaration' },
          i = { vim.lsp.buf.implementation, 'Implementation' },
          r = { vim.lsp.buf.references, 'Reference' },
          t = { vim.lsp.buf.type_definition, 'Type Definition' },
          l = { vim.diagnostic.open_float, 'List Diagnostics' },
          -- default from lsp-zero
          s = { vim.lsp.buf.signature_help, 'Signature Help' },
          o = { vim.lsp.buf.definition, 'Definition' },
        },
        ['<leader>'] = {
          q = { vim.diagnostic.setloclist, 'Diagnostics to LocList' },
        },
        ['<leader>l'] = {
          name = 'LSP',
          r = { vim.lsp.buf.rename, 'Rename' },
          a = { vim.lsp.buf.code_action, 'Code Action' },
          l = { ':Format<CR>', 'Format Buffer' },
          d = { vim.diagnostic.open_float, 'List Diagnostics' },
        },
        [']'] = {
          name = 'Next',
          d = { vim.diagnostic.goto_next, 'Diagnostic' },
        },
        ['['] = {
          d = { vim.diagnostic.goto_prev, 'Diagnostic' },
          name = 'Previous',
        },
      }, { buffer = bufnr })
      local file_type = vim.api.nvim_get_option_value('filetype', { buf = bufnr })
      if file_type == 'go' then
        wk.register {
          ['<leader>'] = {
            E = { 'oif err != nil {<CR>}<Esc>Oreturn', 'Insert go error handling' },
          }
        }
      end
    end)

    -----------------
    -- Setup mason --
    -----------------
    local lspconfig = require('lspconfig')
    require('mason').setup({})
    require('mason-lspconfig').setup({
      ensure_installed = {},
      handlers = {
        lsp_zero.default_setup,

        lua_ls = function ()
          local neodev_config = {
            settings = {
              Lua = {
                completion = {
                  callSnippet = 'Replace'
                }
              }
            }
          }
          local lua_opts = vim.tbl_extend('force', lsp_zero.nvim_lua_ls(), neodev_config)
          lspconfig.lua_ls.setup(lua_opts)
        end,

        pylsp = function ()
          lspconfig.pylsp.setup({
            settings = {
              pylsp = {
                plugins = {
                  pycodestyle = {
                    enabled = true,
                    ignore = {},
                    maxLineLength = 120,
                  },
                  autopep8 = {
                    enabled = true,
                  },
                  flake8 = {
                    enabled = false,
                  },
                  yapf = {
                    enabled = false,
                  },
                  pyflakes = {
                    enabled = false,
                  }
                }
              }
            }
          })
        end,

        jsonls = function ()
          lspconfig.jsonls.setup({
            settings = {
              json = {
                schemas = require('schemastore').json.schemas(),
                validate = { enable = true },
              },
            },
          })
        end,

        yamlls = function ()
          lspconfig.yamlls.setup({
            settings = {
              yaml = {
                schemaStore = {
                  -- You must disable built-in schemaStore support if you want to use
                  -- this plugin and its advanced options like `ignore`.
                  enable = false,
                  -- Avoid TypeError: Cannot read properties of undefined (reading 'length')
                  url = '',
                },
                schemas = require('schemastore').yaml.schemas(),
              },
            },
          })
        end,
      }
    })

    -----------------
    -- Add Roc LSP --
    -----------------
    local lsp_configurations = require('lspconfig.configs')
    if not lsp_configurations.roc_ls then
      lsp_configurations.roc_ls = {
        default_config = {
          name = 'roc_language_server',
          cmd = { 'roc_language_server' },
          filetypes = { 'roc' },
          root_dir = require('lspconfig.util').root_pattern('*.roc')
        }
      }
    end

    ------------------------
    -- LSPs without Mason --
    ------------------------
    lspconfig.roc_ls.setup({})
    lspconfig.gleam.setup({})

    ------------------------------------------
    -- Setup cmp after lsp-zero is required --
    ------------------------------------------
    local cmp = require('cmp')
    local cmp_action = lsp_zero.cmp_action()

    cmp.setup({
      preselect = cmp.PreselectMode.Item,
      mapping = cmp.mapping.preset.insert({
        ['<C-Space>'] = cmp_action.toggle_completion(),
        ['<CR>'] = cmp.mapping.confirm({ select = true, behavior = cmp.ConfirmBehavior.Replace }),
        ['<Tab>'] = cmp_action.luasnip_next_or_expand(),
        ['<S-Tab>'] = cmp_action.select_prev_or_fallback(),
        ['<C-u>'] = cmp.mapping.scroll_docs(-4),
        ['<C-d>'] = cmp.mapping.scroll_docs(4),
      }),
      -- If no match is provided by a group the next will be used.
      sources = cmp.config.sources({
        { name = 'nvim_lsp' },
        { name = 'nvim_lsp_signature_help' },
        { name = 'nvim_lua' },
        { name = 'luasnip' },
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

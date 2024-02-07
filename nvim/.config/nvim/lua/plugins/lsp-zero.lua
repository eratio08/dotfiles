return {
  'VonHeikemen/lsp-zero.nvim',
  branch = 'v3.x',
  lazy = false,
  dependencies = {
    -- LSP Support
    { 'neovim/nvim-lspconfig' },
    { 'williamboman/mason.nvim' },
    { 'williamboman/mason-lspconfig.nvim' },
    { 'ray-x/lsp_signature.nvim' },
    { 'b0o/schemastore.nvim' },

    -- Autocompletion
    { 'hrsh7th/nvim-cmp' },
    { 'hrsh7th/cmp-nvim-lsp' },
    { 'hrsh7th/cmp-buffer' },
    { 'hrsh7th/cmp-path' },
    { 'hrsh7th/cmp-nvim-lua' },
    { 'hrsh7th/cmp-emoji' },
    { 'hrsh7th/cmp-cmdline' },
    { 'petertriho/cmp-git' },
    { 'ray-x/cmp-treesitter' },
    { 'onsails/lspkind-nvim' },
    { 'hrsh7th/cmp-nvim-lsp-signature-help' },
    -- { 'saadparwaiz1/cmp_luasnip' },

    -- Snippets
    { 'L3MON4D3/LuaSnip' },
    { 'rafamadriz/friendly-snippets' },

    -- key bindings
    { 'folke/which-key.nvim' },
  },
  config = function ()
    local lsp_zero = require('lsp-zero')
    lsp_zero.on_attach(function (_, bufnr)
      lsp_zero.default_keymaps({ buffer = bufnr })

      local wk = require('which-key')
      wk.register({
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
        ['<leader>l'] = {
          name = 'LSP',
          r = { vim.lsp.buf.rename, 'Rename' },
          -- R = { ':Lspsaga rename ++project<CR>', 'Project-wide rename' },
          a = { vim.lsp.buf.code_action, 'Code Action' },
          l = { ':Format<CR>', 'Format Buffer' },
          d = { vim.diagnostic.open_float, 'List Diagnostics' },
          -- o = { ':Lspsaga outline<CR>', 'Show Outline' },
        },
        -- ['<leader>F'] = {
        --   name = 'LSP Find',
        --   d = { ':Lspsaga finder def<CR>', 'Definition' },
        --   i = { ':Lspsaga finder imp<CR>', 'Implementation' },
        --   r = { ':Lspsaga finder ref<CR>', 'Reference' },
        --   c = { ':Lspsaga incoming_calls<CR>', 'Incoming Calls' },
        --   C = { ':Lspsaga outgoing_calls<CR>', 'Outgoing Calls' },
        -- },
        K = { vim.lsp.buf.hover, 'Hover Documentation' },
        ['<C-k>'] = { vim.lsp.buf.signature_help, 'Signature Help' },
        [']'] = {
          name = 'Next',
          d = { vim.diagnostic.goto_next, 'Diagnostic' },
        },
        ['['] = {
          name = 'Previous',
          d = { vim.diagnostic.goto_prev, 'Diagnostic' },
        },
      }, { buffer = bufnr })

      -- conditional bindings
      local file_type = vim.api.nvim_get_option_value('filetype', { buf = bufnr })
      if file_type == 'go' then
        wk.register {
          ['<leader>'] = {
            E = { 'oif err != nil {<CR>}<Esc>Oreturn', 'Insert go error handling' },
          }
        }
      end
      -- if file_type == 'python' then
      --   require('pipenv').set_pipenv()
      -- end

      -- Format cmd
      vim.api.nvim_buf_create_user_command(
        bufnr,
        'Format',
        function (_)
          if vim.lsp.buf.format then
            vim.lsp.buf.format({ bufnr = bufnr, async = false })
          end
        end,
        { desc = 'Format current buffer with LSP' }
      )

      -- Auto-format in save
      vim.api.nvim_create_augroup('autoformat_group', { clear = true })
      vim.api.nvim_create_autocmd('BufWritePre', {
        group = 'autoformat_group',
        buffer = bufnr,
        command = 'Format'
      })
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
          local lua_opts = lsp_zero.nvim_lua_ls()
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

        tsserver = function ()
          lspconfig.tsserver.setup({
            on_attach = function (client)
              client.resolved_capabilities.document_formatting = false
            end,
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
        end
      }
    })

    -----------------
    -- Add Roc LSP --
    -----------------
    local lsp_configurations = require('lspconfig.configs')
    if not lsp_configurations.roc_ls then
      lsp_configurations.roc_ls = {
        default_config = {
          name = 'roc_ls',
          cmd = { 'roc_ls' },
          filetypes = { 'roc' },
          root_dir = require('lspconfig.util').root_pattern('*.roc')
        }
      }
    end

    lspconfig.roc_ls.setup({})

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

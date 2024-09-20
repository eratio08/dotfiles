return {
  'neovim/nvim-lspconfig',
  lazy = false,
  dependencies = {
    { 'williamboman/mason.nvim', config = true },
    'WhoIsSethDaniel/mason-tool-installer.nvim',
    'williamboman/mason-lspconfig.nvim',
    'folke/which-key.nvim',
    'kevinhwang91/nvim-ufo',
    'hrsh7th/cmp-nvim-lsp',
    'b0o/schemastore.nvim', -- used by jsonls & yamlls
  },
  config = function ()
    vim.api.nvim_create_autocmd('LspAttach', {
      group = vim.api.nvim_create_augroup('kickstart-lsp-attach', { clear = true }),
      callback = function (event)
        -- custom keymaps
        require('which-key').add({
          {
            'K',
            function ()
              local winid = require('ufo').peekFoldedLinesUnderCursor()
              if not winid then
                vim.lsp.buf.hover()
              end
            end,
            desc = 'Hover Documentation',
            buffer = event.buf,
          },
          -- Go to
          { 'g', group = 'Go to' },
          { 'gd', vim.lsp.buf.definition, desc = 'Go to Definition', buffer = event.bug },
          { 'gD', vim.lsp.buf.declaration, desc = 'Go to Declaration', buffer = event.buf },
          { 'gi', vim.lsp.buf.implementation, desc = 'Go to Implementation', buffer = event.buf },
          { 'gr', vim.lsp.buf.references, desc = 'Go to References', buffer = event.buf },
          { 'gt', vim.lsp.buf.type_definition, desc = 'Go to Type Definition', buffer = event.buf },
          { 'gl', vim.diagnostic.open_float, desc = 'List Diagnostics', buffer = event.buf },
          { 'gs', vim.lsp.buf.signature_help, desc = 'Signature Help', buffer = event.buf },
          { 'go', vim.lsp.buf.definition, desc = 'Go to Definition', buffer = event.buf },
          -- LSP
          { '<leader>l', group = 'LSP' },
          { '<leader>lr', vim.lsp.buf.rename, desc = 'Rename', buffer = event.buf },
          { '<leader>la', vim.lsp.buf.code_action, desc = 'Code Action', buffer = event.buf },
          -- Diagnostics
          { '<leader>q', vim.diagnostic.setloclist, desc = 'Diagnostics to LocList', buffer = event.buf },
          { '[d', vim.diagnostic.goto_prev, desc = 'Previous Diagnostic', buffer = event.buf },
          { ']d', vim.diagnostic.goto_next, desc = 'Next Diagnostic', buffer = event.buf },
        })

        local client = vim.lsp.get_client_by_id(event.data.client_id)
        if client and client.supports_method(vim.lsp.protocol.Methods.textDocument_inlayHint) then
          require('which-key').add({
            {
              '<leader>th',
              function ()
                vim.lsp.inlay_hint.enable(not vim.lsp.inlay_hint.is_enabled { bufnr = event.buf })
              end,
              desc = 'Toggle Inlay Hints',
            }
          })
        end
      end
    }
    )

    -- Servers --
    local servers = {
      lua_ls = {
        settings = {
          Lua = {
            completion = {
              callSnippet = 'Replace',
            },
          },
        },
      },
      pylsp = {
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
      },
      jsonls = {
        settings = {
          json = {
            schemas = require('schemastore').json.schemas(),
            validate = { enable = true },
          },
        },

      },
      yamlls = {
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
      },
      gleam = {},
      roc_ls = {},
    }

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

    -- MASON --
    require('mason').setup()
    require('mason-tool-installer').setup {
      ensure_installed = { 'lua_ls' }
    }

    local capabilities = vim.lsp.protocol.make_client_capabilities()
    capabilities = vim.tbl_deep_extend('force', capabilities, require('cmp_nvim_lsp').default_capabilities())
    require('mason-lspconfig').setup({
      handlers = {

        function (server_name)
          local server = servers[server_name] or {}
          server.capabilities = vim.tbl_deep_extend('force', {}, capabilities, server.capabilities or {})
          require('lspconfig')[server_name].setup(server)
        end,
      }
    })
  end
}

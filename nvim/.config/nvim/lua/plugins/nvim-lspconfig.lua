return {
  enabled = true,
  'neovim/nvim-lspconfig',
  lazy = false,
  dependencies = {
    { 'williamboman/mason.nvim', opts = {} },
    'WhoIsSethDaniel/mason-tool-installer.nvim',
    'williamboman/mason-lspconfig.nvim',
    'folke/which-key.nvim',
    'kevinhwang91/nvim-ufo',
    -- 'hrsh7th/cmp-nvim-lsp',
    'b0o/schemastore.nvim', -- used by jsonls & yamlls
    'saghen/blink.cmp',
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

    vim.inspect(require('schemastore').yaml.schemas())
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
          redhat = { telemetry = { enabled = false } },
          yaml = {
            validate = true,
            schemaStore = {
              enable = false,
              url = '',
            },
            schemas = require('schemastore').yaml.schemas(),
          },
        },
      },
      ocamllsp = {
        settings = {
          codelens = { enable = true },
          inlayHints = { enable = true },
          syntaxDocumentation = { enable = true },
        },
        get_language_id = function (_, lang)
          local map = {
            ['ocaml.mlx'] = 'ocaml',
          }
          return map[lang] or lang
        end,
        filetypes = {
          'ocaml',
          'ocaml.interface',
          'ocaml.menhir',
          'ocaml.cram',
          'ocaml.mlx',
          'ocaml.ocamllex',
          'reason',
          'dune',
        },
      },
      gleam = {},
      lexical = {
        -- tmp to support elixir 1.18 using support_1_18 branch
        cmd = { '/Users/el/src/lexical/_build/dev/package/lexical/bin/start_lexical.sh' },
        root_dir = function (fname)
          return require('lspconfig.util').root_pattern('mix.exs', '.git')(fname) or vim.loop.cwd()
        end,
        filetypes = { 'elixir', 'eelixir', 'heex' },
        settings = {}
      },
      roc_ls = {},
      helmls = {
        settings = {
          ['helm-ls'] = {
            yamlls = {
              enabled = true,
              path = vim.fn.stdpath('data') .. '/mason/bin/yaml-language-server',
            }
          }
        }
      },
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
    require('mason-tool-installer').setup({
      ensure_installed = { 'lua_ls' }
    })

    local capabilities = vim.lsp.protocol.make_client_capabilities()
    capabilities.textDocument.completion.completionItem.snippetSupport = true
    capabilities.textDocument.foldingRange = {
      dynamicRegistration = false,
      lineFoldingOnly = true
    }
    vim.g.if_present('cmp_nvim_lsp', function (cmp_nvim)
      capabilities = vim.tbl_deep_extend('force', capabilities, cmp_nvim.default_capabilities())
    end)
    vim.g.if_present('blink.cmp', function (blink_cmp)
      capabilities = blink_cmp.get_lsp_capabilities(capabilities)
    end)
    require('mason-lspconfig').setup({
      ensure_installed = {},
      automatic_installation = {},
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

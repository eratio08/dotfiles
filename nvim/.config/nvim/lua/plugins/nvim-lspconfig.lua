return {
  enabled = true,
  'neovim/nvim-lspconfig',
  lazy = false,
  dependencies = {
    'mason-org/mason.nvim',
    'mason-org/mason-lspconfig.nvim',
    'folke/which-key.nvim',
    'kevinhwang91/nvim-ufo',
    -- 'hrsh7th/cmp-nvim-lsp',
    'b0o/schemastore.nvim', -- used by jsonls & yamlls
    'saghen/blink.cmp',
  },
  config = function ()
    vim.api.nvim_create_autocmd('LspAttach', {
      group = vim.api.nvim_create_augroup('lsp-attach', { clear = true }),
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
          { 'gd', vim.lsp.buf.definition, desc = 'Go to Definition', buffer = event.buf },
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
          { '[d', function () vim.diagnostic.jump({ count = -1 }) end, desc = 'Previous Diagnostic', buffer = event.buf },
          { ']d', function () vim.diagnostic.jump({ count = 1 }) end, desc = 'Next Diagnostic', buffer = event.buf },
        })

        local client = vim.lsp.get_client_by_id(event.data.client_id)
        if client and client:supports_method(vim.lsp.protocol.Methods.textDocument_documentHighlight, event.buf) then
          local highlight_augroup = vim.api.nvim_create_augroup('lsp-highlight', { clear = false })
          vim.api.nvim_create_autocmd({ 'CursorHold', 'CursorHoldI' }, {
            buffer = event.buf,
            group = highlight_augroup,
            callback = vim.lsp.buf.document_highlight,
          })

          vim.api.nvim_create_autocmd({ 'CursorMoved', 'CursorMovedI' }, {
            buffer = event.buf,
            group = highlight_augroup,
            callback = vim.lsp.buf.clear_references,
          })

          vim.api.nvim_create_autocmd('LspDetach', {
            group = vim.api.nvim_create_augroup('lsp-detach', { clear = true }),
            callback = function (event2)
              vim.lsp.buf.clear_references()
              vim.api.nvim_clear_autocmds { group = 'lsp-highlight', buffer = event2.buf }
            end,
          })
        end

        if client and client:supports_method(vim.lsp.protocol.Methods.textDocument_inlayHint, event.buf) then
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
    })

    -----------------------
    -- Diagnostic Config --
    -----------------------
    vim.diagnostic.config {
      severity_sort = true,
      float = { border = 'rounded', source = 'if_many' },
      underline = { severity = vim.diagnostic.severity.ERROR },
      signs = vim.g.have_nerd_font and {
        text = {
          [vim.diagnostic.severity.ERROR] = '󰅚 ',
          [vim.diagnostic.severity.WARN] = '󰀪 ',
          [vim.diagnostic.severity.INFO] = '󰋽 ',
          [vim.diagnostic.severity.HINT] = '󰌶 ',
        },
      } or {},
      virtual_text = {
        source = 'if_many',
        spacing = 2,
        format = function (diagnostic)
          local diagnostic_message = {
            [vim.diagnostic.severity.ERROR] = diagnostic.message,
            [vim.diagnostic.severity.WARN] = diagnostic.message,
            [vim.diagnostic.severity.INFO] = diagnostic.message,
            [vim.diagnostic.severity.HINT] = diagnostic.message,
          }
          return diagnostic_message[diagnostic.severity]
        end,
      },
    }

    ------------------
    -- Capabilities --
    ------------------
    local capabilities = vim.lsp.protocol.make_client_capabilities()
    -- Disable snippets for now
    -- capabilities.textDocument.completion.completionItem.snippetSupport = true
    vim.g.if_present('ufo', function ()
      capabilities.textDocument.foldingRange = {
        dynamicRegistration = false,
        lineFoldingOnly = true
      }
    end)
    vim.g.if_present('cmp_nvim_lsp', function (cmp_nvim)
      capabilities = vim.tbl_deep_extend('force', capabilities, cmp_nvim.default_capabilities())
    end)
    vim.g.if_present('blink.cmp', function (blink_cmp)
      capabilities = blink_cmp.get_lsp_capabilities(capabilities)
    end)

    vim.lsp.config('*', { capabilities })

    -----------
    -- MASON --
    -----------
    require('mason').setup()
    require('mason-lspconfig').setup({
      automatic_enable = true,
      ensure_installed = { 'lua_ls' },
    })
  end
}

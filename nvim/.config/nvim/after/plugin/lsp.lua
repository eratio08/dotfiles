local lsp = require('lsp-zero')

lsp.preset('recommended')

lsp.on_attach(function (_, bufnr)
  lsp.default_keymaps({ buffer = bufnr })

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
      a = { vim.lsp.buf.code_action, 'Code Action' },
      l = { ':Format<CR>', 'Format Buffer' },
      d = { vim.diagnostic.open_float, 'List Diagnostics' },
    },
    K = { vim.lsp.buf.hover, 'Hover Documentation' },
    ['<C-k>'] = { vim.lsp.buf.signature_help, 'Signature Help' },
    ['['] = {
      name = 'Next',
      d = { vim.diagnostic.goto_next, 'Next Diagnostic' }
    },
    [']'] = {
      name = 'Previous',
      d = { vim.diagnostic.goto_prev, 'Previous Diagnostic' }
    },
  }, { buffer = bufnr })

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

lsp.configure('lua_ls', {
  settings = {
    Lua = {
      runtime = {
        version = 'LuaJIT',
      },
      diagnostics = {
        globals = { 'vim' },
      },
      workspace = {
        library = vim.api.nvim_get_runtime_file('', true),
        checkThirdParty = false,
      },
      telemetry = {
        enable = false,
      },
    },
  },
})

lsp.configure('yamlls', {
  settings = {
    ymls = {
      schemas = {
        ['https://raw.githubusercontent.com/instrumenta/kubernetes-json-schema/master/v1.18.0-standalone-strict/all.json'] = '**/cluster/*.k8s.yml',
        ['https://json.schemastore.org/github-workflow.json'] = '/.github/workflows/*'
      }
    }
  }
})

lsp.configure('docker_compose_language_service', {
  settings = {
    filetypes = { 'yaml' }
  }
})

lsp.setup()


-- Setup cmp after lsp-zero is required
local cmp = require('cmp')
local cmp_action = lsp.cmp_action()

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
  sources = cmp.config.sources({
    { name = 'nvim_lsp' },
    { name = 'nvim_lsp_signature_help' },
    { name = 'nvim_lua' },
    { name = 'luasnip' },
    { name = 'treesitter' },
  }, {
    { name = 'path' },
    { name = 'buffer' },
    { name = 'emoji' },
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

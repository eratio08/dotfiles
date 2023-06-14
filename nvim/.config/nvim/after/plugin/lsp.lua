local lsp = require('lsp-zero')

lsp.preset('recommended')

local luasnip = require('luasnip')
local cmp = require('cmp')
-- special handler for the case of navigation inside of a snipped
local has_words_before = function ()
  unpack = unpack or table.unpack
  local line, col = unpack(vim.api.nvim_win_get_cursor(0))
  return col ~= 0 and vim.api.nvim_buf_get_lines(0, line - 1, line, true)[1]:sub(col, col):match('%s') == nil
end

lsp.setup_nvim_cmp({
  mapping = {
    ['<C-Space>'] = cmp.mapping.complete(),
    ['<CR>'] = cmp.mapping.confirm({
      behavior = cmp.ConfirmBehavior.Replace,
      select = true,
    }),
    ['<Tab>'] = cmp.mapping(function (fallback)
      if cmp.visible() then
        cmp.select_next_item()
      elseif luasnip.expand_or_jumpable() then
        luasnip.expand_or_jump()
      elseif has_words_before() then
        cmp.complete()
      else
        fallback()
      end
    end, { 'i', 's' }),
    ['<S-Tab>'] = cmp.mapping(function (fallback)
      if cmp.visible() then
        cmp.select_prev_item()
      elseif luasnip.jumpable(-1) then
        luasnip.jump(-1)
      else
        fallback()
      end
    end, { 'i', 's' }),
  },
  sources = {
    { name = 'nvim_lsp' },
    { name = 'nvim_lsp_signature_help' },
    { name = 'nvim_lua' },
    { name = 'luasnip' },
    { name = 'treesitter' },
    { name = 'buffer' },
    { name = 'emoji' },
    { name = 'path' },
  },
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

lsp.on_attach(function (_, bufnr)
  lsp.default_keymaps({ buffer = bufnr })

  local wk = require('which-key')
  wk.register({
    g = {
      name = 'Go',
      d = { vim.lsp.buf.definition, 'Definition' },
      i = { vim.lsp.buf.implementation, 'Implementation' },
      r = { vim.lsp.buf.references, 'Reference' },
      t = { vim.lsp.buf.type_definition, 'Type Definition' },
    },
    ['<leader>l'] = {
      name = 'LSP',
      r = { vim.lsp.buf.rename, 'Rename' },
      a = { vim.lsp.buf.code_action, 'Code Action' },
      l = { ':Format<CR>', 'Format Buffer' },
      d = { vim.diagnostic.open_float, 'List of Diagnostics' },
    },
    K = { vim.lsp.buf.hover, 'Hover Documentation' },
    ['<C-k>'] = { vim.lsp.buf.signature_help, 'Signature Documentation' },
    ['['] = {
      name = 'Next',
      d = { vim.diagnostic.goto_next, 'Diagnostics' }
    },
    [']'] = {
      name = 'Previous',
      d = { vim.diagnostic.goto_prev, 'Diagnostics' }
    },
  }, { buffer = bufnr })

  vim.api.nvim_buf_create_user_command(
    bufnr,
    'Format',
    function (_)
      if vim.lsp.buf.format then
        vim.lsp.buf.format({ bufnr = bufnr })
      elseif vim.lsp.buf.formatting then
        vim.lsp.buf.formatting({ bufnr = bufnr })
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

-- Has to be set after setup to work
vim.diagnostic.config({ virtual_text = true })

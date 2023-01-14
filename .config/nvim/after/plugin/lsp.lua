local lsp = require('lsp-zero')

lsp.preset('recommended')

lsp.ensure_installed({
  'tsserver',
  'eslint',
  'sumneko_lua',
  'rust_analyzer',
})

local luasnip = require("luasnip")
local cmp = require("cmp")

-- special handler for the case of navigation inside of a snipped
local has_words_before = function()
  unpack = unpack or table.unpack
  local line, col = unpack(vim.api.nvim_win_get_cursor(0))
  return col ~= 0 and vim.api.nvim_buf_get_lines(0, line - 1, line, true)[1]:sub(col, col):match("%s") == nil
end

lsp.setup_nvim_cmp({
  mapping = {
    ['<C-Space>'] = cmp.mapping.complete(),
    ['<CR>'] = cmp.mapping.confirm({
      behavior = cmp.ConfirmBehavior.Replace,
      select = true,
    }),
    ["<Tab>"] = cmp.mapping(function(fallback)
      if cmp.visible() then
        cmp.select_next_item()
      elseif luasnip.expand_or_jumpable() then
        luasnip.expand_or_jump()
      elseif has_words_before() then
        cmp.complete()
      else
        fallback()
      end
    end, { "i", "s" }),
    ["<S-Tab>"] = cmp.mapping(function(fallback)
      if cmp.visible() then
        cmp.select_prev_item()
      elseif luasnip.jumpable(-1) then
        luasnip.jump(-1)
      else
        fallback()
      end
    end, { "i", "s" }),
  },
  sources = {
    { name = 'emoji' },
    { name = 'path' },
    { name = 'nvim_lsp', keyword_length = 3 },
    { name = 'treesitter', keyword_length = 3 },
    { name = 'buffer', keyword_length = 3 },
    { name = 'luasnip', keyword_length = 2 },
    { name = 'nvim_lua', keyword_length = 2 },
  },
  formatting = {
    format = require('lspkind').cmp_format({
      mode = 'symbol_text',
      maxwidth = 50,
      menu = {
        buffer = '',
        nvim_lsp = '',
        nvim_lua = '',
        path = '',
        luasnip = '',
        treesitter = '',
        emoji = 'ﲃ',
        cmp_git = '',
        cmdline = '',
      },
    }),
  },
})

lsp.on_attach(function(client, bufnr)
  local wk = require("which-key")
  wk.register({
    g = {
      name = 'Go',
      d = { vim.lsp.buf.definition, "Definition" },
      i = { vim.lsp.buf.implementation, 'to Implementation' },
      r = { vim.lsp.buf.references, 'Reference' },
      l = { vim.diagnostic.open_float, 'List of Diagnostics' },
      t = { vim.lsp.buf.type_definition, 'Type Definition' },
    },
    ['<leader>l'] = {
      name = 'LSP',
      r = { vim.lsp.buf.rename, 'Rename' },
      a = { vim.lsp.buf.code_action, 'Code Action' },
      l = { ':Format<CR>', 'Format Buffer' },
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
    function(_)
      if vim.lsp.buf.format then
        vim.lsp.buf.format()
      elseif vim.lsp.buf.formatting then
        vim.lsp.buf.formatting()
      end
    end,
    { desc = 'Format current buffer with LSP' }
  )

  -- Auto-format in save
  vim.api.nvim_clear_autocmds({ group = autoformat_group, buffer = bufnr })
  vim.api.nvim_create_autocmd('BufWritePre', {
    group = autoformat_group,
    buffer = bufnr,
    callback = function() vim.lsp.buf.format({ bufnr = bufnr }) end
  })
end)

lsp.setup()

vim.diagnostic.config({ virtual_text = true })

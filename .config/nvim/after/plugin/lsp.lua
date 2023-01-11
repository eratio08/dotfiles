local lsp = require('lsp-zero')

lsp.preset('recommended')

lsp.ensure_installed({
  'tsserver',
  'eslint',
  'sumneko_lua',
  'rust_analyzer',
})

local has_words_before = function()
  unpack = unpack or table.unpack
  local line, col = unpack(vim.api.nvim_win_get_cursor(0))
  return col ~= 0 and vim.api.nvim_buf_get_lines(0, line - 1, line, true)[1]:sub(col, col):match("%s") == nil
end

local luasnip = require("luasnip")
local cmp = require("cmp")

lsp.setup_nvim_cmp({
  mapping = {
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
  select_behavior = 'select',
  completion = {
    completeopt = 'menu,menuone,noinsert'
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
      r = { require('telescope.builtin').lsp_references, 'Reference' },
    },
    ['<leader>l'] = {
      name = 'LSP',
      r = { vim.lsp.buf.rename, 'Re-Name' },
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

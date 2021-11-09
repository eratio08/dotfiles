-- hrsh7th/nvim-cmp
local requireIfPresent = require('eratio.utils').requireIfPresent
local cmp = requireIfPresent('cmp')

if not cmp then
  return
end

cmp.setup({
  completion = {
    completeopt = 'menu,menuone',
  },
  snippet = {
    expand = function(args)
      require('luasnip').lsp_expand(args.body)
    end,
  },
  mapping = {
    ['<C-d>'] = cmp.mapping(cmp.mapping.scroll_docs(-4), { 'i', 'c' }),
    ['<C-f>'] = cmp.mapping(cmp.mapping.scroll_docs(4), { 'i', 'c' }),
    ['<C-Space>'] = cmp.mapping(cmp.mapping.complete(), { 'i', 'c' }),
    ['<C-e>'] = cmp.mapping.close(),
    ['<CR>'] = cmp.mapping.confirm({
      behavior = cmp.ConfirmBehavior.Replace,
      select = true,
    }),
    ['<Tab>'] = cmp.mapping.select_next_item(),
    ['<S-Tab>'] = cmp.mapping.select_next_item(),
  },
  sources = cmp.config.sources({
    { name = 'nvim_lua' },
    { name = 'nvim_lsp', max_item_count = 20 },
    { name = 'luasnip', max_item_count = 20 },
  }, {
    { name = 'emoji' },
    { name = 'buffer', keyword_length = 5, max_item_count = 20 },
  }),
  experimental = {
    native_menu = false,
    ghost_text = true,
  },
})

-- Bind sources to `/`.
cmp.setup.cmdline('/', {
  sources = {
    { name = 'buffer', max_item_count = 20 },
    { name = 'path', max_item_count = 20 },
  },
})

-- Bind sources to ':'.
cmp.setup.cmdline(':', {
  sources = cmp.config.sources({
    { name = 'path', max_item_count = 20 },
  }),
})

local lspkind = require('lspkind')
if lspkind then
  cmp.setup({
    formatting = {
      format = lspkind.cmp_format({
        with_text = false,
        maxwidth = 50,
        menu = {
          buffer = '[buf]',
          nvim_lsp = '[LSP]',
          nvim_lua = '[api]',
          path = '[path]',
          luasnip = '[snip]',
        },
      }),
    },
  })
end

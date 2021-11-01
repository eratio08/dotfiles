-- hrsh7th/nvim-cmp

local g = vim.g

if g.plugs["nvim-cmp"] then

-- Setup nvim-cmp.
local cmp = require('cmp')

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
    { name = 'nvim_lsp' },
    { name = 'luasnip' },
  }, {
    { name = 'emoji', max_item_count= 10 },
    { name = 'buffer' },
  }),
})

-- Bind sources to `/`.
cmp.setup.cmdline('/', {
  sources = {
    { name = 'buffer', max_item_count= 10 }
  }
})

-- Bind sources to ':'.
cmp.setup.cmdline(':', {
  sources = cmp.config.sources({
    { name = 'path', max_item_count= 10 }
  }, {
    -- { name = 'cmdline', max_item_count= 10 }
  })
})

end

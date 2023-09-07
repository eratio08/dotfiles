return {
  'VonHeikemen/lsp-zero.nvim',
  branch = 'v2.x',
  lazy = false,
  dependencies = {
    -- LSP Support
    { 'neovim/nvim-lspconfig' },
    { 'williamboman/mason.nvim', build = ':MasonUpdate' },
    { 'williamboman/mason-lspconfig.nvim' },
    { 'ray-x/lsp_signature.nvim' },

    -- Autocompletion
    { 'hrsh7th/nvim-cmp' },
    { 'hrsh7th/cmp-buffer' },
    { 'hrsh7th/cmp-path' },
    { 'saadparwaiz1/cmp_luasnip' },
    { 'hrsh7th/cmp-nvim-lsp' },
    { 'hrsh7th/cmp-nvim-lua' },
    { 'hrsh7th/cmp-emoji' },
    { 'hrsh7th/cmp-cmdline' },
    { 'petertriho/cmp-git' },
    { 'ray-x/cmp-treesitter' },
    { 'onsails/lspkind-nvim' },
    { 'hrsh7th/cmp-nvim-lsp-signature-help' },

    -- Snippets
    { 'L3MON4D3/LuaSnip' },

    -- Snippet Collection (Optional)
    { 'rafamadriz/friendly-snippets' },

    -- key bindings
    { 'folke/which-key.nvim' },
  },
  config = function ()
    local lsp = require('lsp-zero')
    lsp.preset('recommended')

    lsp.on_attach(function (_, bufnr)
      lsp.default_keymaps({ buffer = bufnr })

      local wk = require('which-key')
      wk.register({
        g = {
          name = 'Go',
          -- d = { vim.lsp.buf.definition, 'Definition' },
          d = { ':Lspsaga goto_type_definition<CR>', 'Definition' },
          D = { vim.lsp.buf.declaration, 'Declaration' },
          i = { vim.lsp.buf.implementation, 'Implementation' },
          r = { vim.lsp.buf.references, 'Reference' },
          t = { vim.lsp.buf.type_definition, 'Type Definition' },
          -- l = { vim.diagnostic.open_float, 'List Diagnostics' },
          l = { ':Lspsaga show_line_diagnostics<CR>', 'Show Line Diagnostics' },
          -- default from lsp-zero
          s = { vim.lsp.buf.signature_help, 'Signature Help' },
          o = { vim.lsp.buf.definition, 'Definition' },
        },
        ['<leader>l'] = {
          name = 'LSP',
          -- R = { vim.lsp.buf.rename, 'Rename' },
          r = { ':Lspsaga rename<CR>', 'Rename' },
          R = { ':Lspsaga rename ++project<CR>', 'Project-wise rename' },
          a = { vim.lsp.buf.code_action, 'Code Action' },
          l = { ':Format<CR>', 'Format Buffer' },
          -- d = { vim.diagnostic.open_float, 'List Diagnostics' },
          o = { ':Lspsaga outline<CR>', 'Show Outline' },
        },
        ['<leader>F'] = {
          name = 'LSP Find',
          d = { ':Lspsaga finder def<CR>', 'Definition' },
          i = { ':Lspsaga finder imp<CR>', 'Implementation' },
          r = { ':Lspsaga finder ref<CR>', 'Reference' },
          c = { ':Lspsaga incoming_calls<CR>', 'Incoming Calls' },
          C = { ':Lspsaga outgoing_calls<CR>', 'Outgoing Calls' },
        },
        -- K = { vim.lsp.buf.hover, 'Hover Documentation' },
        K = { ':Lspsaga hover_doc<CR>', 'Hover Documentation' },
        ['<C-k>'] = { vim.lsp.buf.signature_help, 'Signature Help' },
        ['['] = {
          name = 'Next',
          -- d = { vim.diagnostic.goto_next, 'Diagnostic' }
          d = { ':Lspsaga diagnostic_jump_next<CR>', 'Diagnostic' }
        },
        [']'] = {
          name = 'Previous',
          -- d = { vim.diagnostic.goto_prev, 'Diagnostic' }
          d = { ':Lspsaga diagnostic_jump_prev<CR>', 'Diagnostic' }
        },
      }, { buffer = bufnr })

      -- conditional bindings
      local file_type = vim.api.nvim_buf_get_option(bufnr, 'filetype')
      if file_type == 'go' then
        wk.register {
          ['<leader>'] = {
            E = { 'oif err != nil {<CR>}<Esc>Oreturn', 'Insert go error handling' },
          }
        }
      end

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

    lsp.setup()

    ------------------------------------------
    -- Setup cmp after lsp-zero is required --
    ------------------------------------------
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

-------------
-- Prelude --
-------------
local utils = require('eratio.utils')
local g = vim.g
local cmd = vim.cmd
local opt = vim.opt
local map = vim.keymap.set
local ifPresent = utils.ifPresent
local augroup = utils.augroup

--------------------
-- Extend vim std --
--------------------
-- fold over table entries
vim.tbl_foldr = function(fn, initial, tbl)
  local acc = vim.deepcopy(initial)

  for _, entry in ipairs(tbl) do
    acc = fn(entry, acc)
  end
  return acc
end

--------------------
-- Install packer --
--------------------
local pack_path = vim.fn.stdpath('data') .. '/site/pack'
local packer_path = pack_path .. '/packer/start/packer.nvim'

if vim.fn.empty(vim.fn.glob(packer_path)) > 0 then
  vim.fn.execute('!git clone --depth=1 https://github.com/wbthomason/packer.nvim' .. packer_path)
end

-- Compile packer lazy loading script on save
augroup({ { 'BufWritePost', 'init.lua', 'PackerCompile' } }, 'Packer')

---------------------
-- Install plugins --
---------------------
ifPresent('packer', function(packer)
  local use = packer.use
  packer.startup({
    function()
      -- Package manager
      use('wbthomason/packer.nvim')

      -- Theme
      use('shaunsingh/nord.nvim')

      -- Status bar
      use('nvim-lualine/lualine.nvim')

      -- Test runner
      use('vim-test/vim-test')

      -- Editor config
      use('editorconfig/editorconfig-vim')

      -- Git integration
      use('tpope/vim-fugitive')

      -- Git markers in sign column
      use({ 'lewis6991/gitsigns.nvim', requires = { 'nvim-lua/plenary.nvim' } })

      -- GitHub integration
      -- use('tpope/vim-rhubarb')

      -- Commenting
      use('numToStr/Comment.nvim')

      -- ][ Movement helpers
      use('tpope/vim-unimpaired')

      -- Language Server Protocol
      use('neovim/nvim-lspconfig')
      use('nvim-lua/lsp_extensions.nvim')
      use('williamboman/nvim-lsp-installer')
      use('j-hui/fidget.nvim')

      -- Completion
      use('hrsh7th/nvim-cmp')
      use('hrsh7th/cmp-nvim-lsp')
      use('hrsh7th/cmp-nvim-lua')
      use('hrsh7th/cmp-buffer')
      use('hrsh7th/cmp-git')
      -- use('hrsh7th/cmp-path')
      use('hrsh7th/cmp-cmdline')
      use('hrsh7th/cmp-emoji')
      use('onsails/lspkind-nvim')
      use('ray-x/cmp-treesitter')

      -- Snippets
      use('L3MON4D3/LuaSnip')
      use('saadparwaiz1/cmp_luasnip')
      use('rafamadriz/friendly-snippets')

      -- Telescope
      use({ 'nvim-telescope/telescope.nvim', requires = { 'nvim-lua/plenary.nvim' } })
      use('nvim-telescope/telescope-fzy-native.nvim')
      use('nvim-telescope/telescope-file-browser.nvim')
      use('nvim-telescope/telescope-dap.nvim')
      use('nvim-telescope/telescope-ui-select.nvim')
      use({ 'nvim-telescope/telescope-smart-history.nvim', requires = { 'tami5/sqlite.lua' } })

      -- Icons
      use('kyazdani42/nvim-web-devicons')

      -- Tree sitter
      use({ 'nvim-treesitter/nvim-treesitter', run = ':TSUpdate' })
      use('nvim-treesitter/nvim-treesitter-textobjects')
      use('lewis6991/spellsitter.nvim')
      use('p00f/nvim-ts-rainbow')
      use('JoosepAlviste/nvim-ts-context-commentstring')

      -- Automatic tags management
      -- use('ludovicchabant/vim-gutentags')

      -- Indentation guides
      use('lukas-reineke/indent-blankline.nvim')

      -- Debug Adapter Protocol
      use('mfussenegger/nvim-dap')
      use('rcarriga/nvim-dap-ui')
      use('theHamsta/nvim-dap-virtual-text')

      -- V Language
      use({ 'tami5/vlang.nvim', requires = { 'cheap-glitch/vim-v', 'nvim-lua/plenary.nvim' } })
    end,

    -------------------
    -- configuration --
    -------------------
    config = {
      display = {
        open_fn = require('packer.util').float,
      },
      profile = {
        enable = false,
        threshold = 1,
      },
    },
  })
end)

--------------
-- Settings --
--------------
opt.tabstop = 2 -- set tab width to 2 spaces
opt.softtabstop = 2 -- spaces inserted for a tab
opt.shiftwidth = 2 -- indentation width to 2 spaces
opt.expandtab = true -- replace tabs with spaces on insert
opt.cmdheight = 1 -- height of the message line at the bottom
opt.updatetime = 50 -- time until vim updates the frame, time for combined commands
opt.shortmess:append('c') -- don't give |ins-completion-menu| messages
opt.signcolumn = 'yes' -- always show sign columns
opt.number = true -- show line numbers
opt.relativenumber = true -- enable relative line numbers
opt.swapfile = false -- disable swap files
opt.backup = false -- no backup files
opt.hlsearch = true -- highlight all search results
opt.writebackup = false -- turn of backup when overwriting files
opt.errorbells = false -- disable the error bells
opt.wrap = false -- disable wrapping
opt.ignorecase = true -- search case insensitive by default
opt.smartcase = true -- if capital letter is used be case sensitive
opt.incsearch = true -- sow search results immediately
opt.spell = true -- set spell checking language to en_us
opt.spelllang = 'en_us'
opt.smartindent = true -- enable auto indentation on next line
opt.path:append('**') -- enable vim-native fuzzy find
opt.wildmenu = true -- enable wild match window
opt.wildmode = { 'longest', 'list', 'full' } -- Nice menu when typing `:find ...`
opt.wildignore:append({
  '*.pyc',
  '*_build/*',
  '**/coverage/*',
  '**/node_modules/*',
  '**/android/*',
  '**/ios/*',
  '**/.git/*',
}) -- Ignore files when wild card matching
opt.hidden = true -- keep buffers on navigation
opt.background = 'dark' -- opt.background color brightness
opt.undofile = true -- enable undo file
opt.scrolloff = 10 --- opt.undo file location- add scroll offset
opt.colorcolumn = { 80, 120 } -- vertical marker at column
opt.list = true -- show invisible characters
opt.listchars = 'tab:▸\\,space:·,eol:,trail:_'
opt.guicursor = '' -- disable cursor styles
opt.termguicolors = true -- disable to prevent tmux overlay
opt.isfname:append('@-@') -- opt.how files names are displayed
opt.mouse = 'a' -- enable mouse support for all modes
opt.splitright = true -- horizontal split windows to the right
opt.splitbelow = true -- vertical split windows to below
opt.diffopt:append('vertical') -- diff windows split to vertical
opt.completeopt = { 'menu', 'menuone', 'noselect' } -- show auto completion menu even for single item
opt.splitright = true -- split to the right
opt.foldenable = false -- unfold all by default
opt.shada = { '!', "'1000", '<50', 's10' } -- set shared data saving, global upper case variables, 1000 marks, 50 lines per register, max 10KiB
opt.fixendofline = true
g.do_filetype_lua = 1

--------------
-- Commands --
--------------
-- cmd([[syntax on]]) -- enabled syntax highlighting

--------------
-- Mappings --
--------------
map('c', 'HR', 'vert bo h') -- open help in vertical split
map('n', '<space>s', '1z=') -- replace spelling mistake with first match
map('n', '<space>pv', ':wincmd v<bar> :Ex <bar> :vertical resize 30<CR>') -- open explorer in vertical split
map('c', '%%', "<C-R>=fnameescape(expand('%:h')).'/'<CR>") -- open to edit helpers - expand %% to current working directory
map('n', '<space>ew', ':e %%') -- edit in new window
map('n', '<space>es', ':sp %%') -- edit in new split
map('n', '<space>ev', ':vsp %%') -- edit in new vertical split
map('n', '<space>et', ':tabe %%') -- edit in new tab
map('n', '"*', ':call system("wl-copy", @")<CR>') -- copy to clipboard for wayland
map('v', '"*', ':call system("wl-copy", @")<CR>') -- copy to clipboard for wayland

-- move single line down
map('n', '<A-j>', 'ddp')
map('v', '<A-j>', 'xp`[V`]')
-- move single line up
map('n', '<A-k>', 'ddkP')
map('v', '<A-k>', 'xkP`[V`]')

-- disable arrow keys
map('n', '<Up>', '<Nop>')
map('n', '<Down>', '<Nop>')
map('n', '<Left>', '<Nop>')
map('n', '<Right>', '<Nop>')

-----------
-- netrw --
-----------
-- enable native netrw plugin
vim.cmd('filetype plugin indent on')

g.netrw_liststyle = 3 -- open netrw in tree mode
g.netrw_banner = 0 -- remove banner from netrw
g.netrw_browser_split = 0 -- reuse curent window when opening netrw
-- g.netrw_browse_split = 4 -- keep netrw open
g.netrw_winsize = 25 -- set initial windows size
g.netrw_altv = 1 -- view on the left
-- g.netrw_localrndir = 'rm -r' -- set command used for directory rm

--------------------------
-- shaunsingh/nord.nvim --
--------------------------
ifPresent('nord', function(nord)
  g.nord_italic = false -- disable italic of the color scheme
  nord.set()
end)

---------------------------
-- neovim/nvim-lspconfig --
---------------------------
ifPresent('lspconfig', function(lspconfig)
  local C = {}

  -- mappings
  map('n', 'gd', ':lua vim.lsp.buf.definition()<CR>')
  map('n', 'gi', ':lua vim.lsp.buf.implementation()<CR>')
  map('n', 'gsh', ':lua vim.lsp.buf.signature_help()<CR>')
  map('n', 'grr', ':lua vim.lsp.buf.references()<CR>')
  map('n', 'grn', ':lua vim.lsp.buf.rename()<CR>')
  map('n', 'gh', ':lua vim.lsp.buf.hover()<CR>')
  map('n', 'gca', ':lua vim.lsp.buf.code_action()<CR>')
  map('n', 'ge', ':lua vim.diagnostic.show_line_diagnostics()<CR>')
  map('n', ']e', ':lua vim.diagnostic.goto_next()<CR>')
  map('n', '[e', ':lua vim.diagnostic.goto_prev()<CR>')

  map('n', 'gdc', ':lua vim.lsp.buf.declaration()<CR>')
  map('n', 'gtd', ':lua vim.lsp.buf.type_definition()<CR>')

  -- work space files
  map('n', '<space>wa', ':lua vim.lsp.buf.add_workspace_folder()<CR>')
  map('n', '<space>wr', ':lua vim.lsp.buf.remove_workspace_folder()<CR>')
  map('n', '<space>wl', ':lua print(vim.inspect(vim.lsp.buf.list_workspace_folders()))<CR>')

  -- trigger formatting
  map('n', '<space>ll', ':lua vim.lsp.buf.formatting_sync(nil, 300)<CR>')

  -- use LSP formatting on save
  local exts = vim.tbl_foldr(
    function(s, acc)
      return acc .. '*.' .. s .. ','
    end,
    '',
    {
      'rs',
      'elm',
      'js',
      'mjs',
      'ts',
      'tsx',
      'kt',
      'java',
      'lua',
      'html',
      'vue',
      'json',
      'py',
      'tf',
      'toml',
      'tml',
      'yaml',
      'yml',
    }
  )

  augroup({ { 'BufWritePre', exts, 'lua vim.lsp.buf.formatting_sync(nil, 300)' } }, 'fmt')

  -- wrapper for common configurations
  local function config(_config)
    local capabilities = vim.lsp.protocol.make_client_capabilities()
    -- augment capabilities with cmp_nvim_lsp
    capabilities = require('cmp_nvim_lsp').update_capabilities(capabilities)

    return vim.tbl_deep_extend('force', {
      capabilities = capabilities,
    }, _config or {})
  end

  -- diagnostics highlighting touchup
  vim.lsp.handlers['textDocument/publishDiagnostics'] = vim.lsp.with(vim.lsp.diagnostic.on_publish_diagnostics, {
    -- Disable underline, it's very annoying
    underline = false,
  })

  C.tsserver = config({
    commands = {
      OrganizeImports = {
        function()
          vim.lsp.buf.execute_command({
            command = '_typescript.organizeImports',
            arguments = { vim.api.nvim_buf_get_name(0) },
            title = '',
          })
        end,
        description = 'Organize Imports',
      },
    },
  })

  C.kotlin_language_server = config()

  C.elm = config({
    init_options = {
      elmReviewDiagnostics = 'warning',
    },
  })

  -- Setup is done by rust-tools
  C.rust_analyzer = config({
    settings = {
      ['rust-analyzer'] = {
        cargo = { autoreload = true },
        checkOnSave = {
          command = 'clippy',
        },
        assist = {
          importGranularity = 'item',
          allowMergingIntoGlobImports = false,
        },
      },
    },
  })

  C.sumneko_lua = config({
    cmd = { '/usr/bin/lua-language-server', '-E' },
    settings = {
      Lua = {
        runtime = {
          -- Tell the language server which version of Lua you're using (most likely LuaJIT in the case of Neovim)
          version = 'LuaJIT',
          -- Setup your lua path
          path = vim.split(package.path, ';'),
        },
        diagnostics = {
          -- Get the language server to recognize the `vim` global
          globals = { 'vim' },
        },
        workspace = {
          -- Make the server aware of Neovim runtime files
          library = {
            [vim.fn.expand('$VIMRUNTIME/lua')] = true,
            [vim.fn.expand('$VIMRUNTIME/lua/vim/lsp')] = true,
          },
        },
        -- Do not send telemetry data containing a randomized but unique identifier
        telemetry = {
          enable = false,
        },
      },
    },
  })

  C.eslint = config({
    on_attach = function(_, _)
      -- trigger EslintFixAll on save
      cmd('autocmd BufWritePre *.ts,*.js,*.vue, EslintFixAll')
    end,
    settings = {
      codeActionOnSave = {
        enable = true,
        mode = 'all',
      },
      format = true,
    },
  })

  C.tailwindcss = config({
    init_options = {
      userLanguages = {
        elm = 'html',
      },
    },
    filetypes = {
      'elm',
      'htm',
      'javascript',
      'typescript',
      'css',
      'vue',
    },
    settings = {
      tailwindCSS = {
        classAttributes = { 'class', 'className', 'classList', 'ngClass' },
        lint = {
          cssConflict = 'warning',
          invalidApply = 'error',
          invalidConfigPath = 'error',
          invalidScreen = 'error',
          invalidTailwindDirective = 'error',
          invalidVariant = 'error',
          recommendedVariantOrder = 'warning',
        },
        validate = true,
        experimental = {
          classRegex = { '\\bclass\\s+"([^"]*)"' },
        },
      },
    },
  })

  C.volar = config()

  C.pyright = config()

  C.pylsp = config()

  C.terraform_lsp = config()

  C.tflint = config()

  C.taplo = config()

  C.yamlls = config()

  C.dockerls = config()

  -- Not yet supported by nvim-lsp-installer
  -- C.vls = config({
  --   cmd = {vls_binary = '/usr/local/bin/vls'}
  -- })

  lspconfig.vls.setup(config({
    cmd = { '/usr/local/bin/vls' },
  }))

  -------------------------------------
  -- williamboman/nvim-lsp-installer --
  -------------------------------------
  ifPresent('nvim-lsp-installer', function(lsp_installer)
    lsp_installer.on_server_ready(function(server)
      local opts = C[server.name]

      if opts == nil then
        print('[' .. server.name .. '] ❎')
        opts = {}
      else
        print('[' .. server.name .. '] ✔️')
      end

      server:setup(opts)
    end)
  end)

  ifPresent('fidget', function(fidget)
    fidget.setup({
      text = {
        spinner = 'moon',
      },
    })
  end)
end)

----------------------------------
-- nvim-lua/lsp_extensions.nvim --
----------------------------------
ifPresent('lsp_extensions', function(_)
  local extensions = '*.rs'
  augroup({
    {
      'InsertLeave,BufWritePost',
      extensions,
      ':lua require("lsp_extensions").inlay_hints({ prefix = " » ", highlight = "Comment" })',
    },
  }, 'inlay_hints_cmd')
end)

-----------------------------------
-- nvim-telescope/telescope.nvim --
-----------------------------------
ifPresent('telescope', function(telescope)
  -- find in files or buffer
  map('n', '<Space>fr', ':Telescope resume<CR>')
  map('n', '<Space>ff', ':Telescope find_files<CR>')
  map('n', '<Space>fg', ':Telescope live_grep<CR>')
  map('n', '<Space>fb', ':Telescope buffers<CR>')
  map('n', '<Space>fc', ':lua require("eratio/telescope-helpers").current_buffer_fuzzy_find()<CR>')
  map('n', '<Space>,', ':lua require("eratio/telescope-helpers").search_nvim_config()<CR>')

  -- git
  map('n', '<Space>fgs', ':Telescope git_status<CR>')
  map('n', '<Space>fgc', ':Telescope git_commits<CR>')
  map('n', '<Space>fgb', ':Telescope git_branches<CR>')

  -- find in vim
  map('n', '<Space>fh', ':Telescope help_tags<CR>')
  map('n', '<Space>fvo', ': Telescope vim_options<CR>')
  map('n', '<Space>fcm', ': Telescope commands<CR>')

  -- file browser
  map('n', '<Space>bb', ':Telescope file_browser<CR>')

  -- list errors
  map('n', '<Space>fe', '<cmd>Telescope diagnostics<CR>')

  telescope.setup({
    defaults = {
      -- setting here
      prompt_prefix = '> ',
      color_devicons = true,
      history = {
        path = '~/.local/share/nvim/databases/telescope_history.sqlite3',
        limit = 100,
      },
    },
    pickers = {
      find_files = {
        theme = 'dropdown',
      },
      live_grep = {
        prompt_title = 'Live Grep',
        theme = 'dropdown',
      },
      buffers = {
        theme = 'dropdown',
      },
      diagnostics = {
        theme = 'dropdown',
      },
    },
    extensions = {
      fzy_native = {
        override_generic_sorter = false,
        override_file_sorter = true,
      },
      file_browser = {
        theme = 'dropdown',
        path = '%:p:h',
      },
      ['ui-select'] = {
        require('telescope.themes').get_dropdown({}),
      },
    },
  })

  -- Load telescope helpers
  require('eratio.telescope-helpers')

  -- plugins
  telescope.load_extension('fzy_native')
  telescope.load_extension('file_browser')
  telescope.load_extension('dap')
  telescope.load_extension('ui-select')
  telescope.load_extension('smart_history')
end)

---------------------------
-- numToStr/Comment.nvim --
---------------------------
ifPresent('Comment', function(comment)
  comment.setup()
end)

----------------------------------
-- kyazdani42/nvim-web-devicons --
----------------------------------
ifPresent('nvim-web-devicons', function(web_devicons)
  web_devicons.setup({
    default = true,
  })
end)

-------------------------------
-- nvim-lualine/lualine.nvim --
-------------------------------
ifPresent('lualine', function(lualine)
  lualine.setup({
    options = {
      icons_enabled = true,
      theme = 'nord',
      component_separators = { left = '', right = '' },
      section_separators = { left = '', right = '' },
      disabled_filetypes = {},
      always_divide_middle = true,
    },
    sections = {
      lualine_a = { 'mode' },
      lualine_b = { 'branch', 'diff', { 'diagnostics', sources = { 'nvim_diagnostic' } } },
      lualine_c = { { 'filename', path = 1 } },
      lualine_x = { 'encoding', 'fileformat', 'filetype' },
      lualine_y = { 'progress' },
      lualine_z = { 'location' },
    },
    inactive_sections = {
      lualine_a = {},
      lualine_b = {},
      lualine_c = { 'filename' },
      lualine_x = { 'location' },
      lualine_y = {},
      lualine_z = {},
    },
    tabline = {},
    extensions = {},
  })
end)

----------------------
-- hrsh7th/nvim-cmp --
----------------------
ifPresent('cmp', function(cmp)
  ----------------------
  -- L3MON4D3/LuaSnip --
  ----------------------
  local has_words_before = function()
    local line, col = unpack(vim.api.nvim_win_get_cursor(0))
    return col ~= 0 and vim.api.nvim_buf_get_lines(0, line - 1, line, true)[1]:sub(col, col):match('%s') == nil
  end

  ifPresent('luasnip', function(luasnip)
    cmp.setup({
      snippet = {
        expand = function(args)
          luasnip.lsp_expand(args.body)
        end,
      },
      mapping = cmp.mapping.preset.insert({
        ['<C-b>'] = cmp.mapping.scroll_docs(-4),
        ['<C-f>'] = cmp.mapping.scroll_docs(4),
        ['<C-Space>'] = cmp.mapping.complete(),
        ['<C-e>'] = cmp.mapping.abort(),
        ['<CR>'] = cmp.mapping.confirm({ select = true }),
        ['<Tab>'] = cmp.mapping(function(fallback)
          if cmp.visible() then
            cmp.select_next_item()
          elseif luasnip.expand_or_jumpable() then
            luasnip.expand_or_jump()
          elseif has_words_before() then
            cmp.complete()
          else
            fallback()
          end
        end, {
          'i',
          's',
        }),
        ['<S-Tab>'] = cmp.mapping(function(fallback)
          if cmp.visible() then
            cmp.select_prev_item()
          elseif luasnip.jumpable(-1) then
            luasnip.jump(-1)
          else
            fallback()
          end
        end, {
          'i',
          's',
        }),
      }),
      sources = cmp.config.sources({
        { name = 'luasnip' },
      }, {
        { name = 'treesitter' },
        { name = 'nvim_lsp' },
        { name = 'buffer', keyword_length = 3, max_item_count = 5 },
      }, {
        { name = 'nvim_lua' },
      }, {
        { name = 'emoji' },
      }),
      -- view = {
      --   entries = 'native',
      -- },
      experimental = {
        ghost_text = true,
      },
    })

    -- Bind sources to `/`.
    cmp.setup.cmdline('/', {
      mapping = cmp.mapping.preset.cmdline(),
      sources = cmp.config.sources({
        { name = 'buffer', max_item_count = 20 },
        { name = 'path', max_item_count = 20 },
      }),
    })

    -- Bind sources to ':'.
    cmp.setup.cmdline(':', {
      mapping = cmp.mapping.preset.cmdline(),
      sources = cmp.config.sources({
        { name = 'path', max_item_count = 20 },
        { name = 'cmdline' },
      }),
    })

    cmp.setup.filetype('gitcommit', {
      sources = cmp.config.sources({
        { name = 'emoji' },
        { name = 'cmp_git' },
        { name = 'buffer' },
      }),
    })

    ifPresent('luasnip.loaders.from_vscode', function(luasnip_loader)
      ----------------------------------
      -- rafamadriz/friendly-snippets --
      ----------------------------------
      local snippets_paths = function()
        local plugins = { 'friendly-snippets' }
        local paths = {}
        local path
        local root_path = pack_path .. ''
        for _, plug in ipairs(plugins) do
          path = root_path .. plug
          if vim.fn.isdirectory(path) ~= 0 then
            table.insert(paths, path)
          end
        end
        return paths
      end

      luasnip_loader.lazy_load({
        paths = snippets_paths(),
        include = nil, -- Load all languages
        exclude = {},
      })
    end)

    --------------------------
    -- onsails/lspkind-nvim --
    --------------------------
    ifPresent('lspkind', function(lspkind)
      cmp.setup({
        formatting = {
          format = lspkind.cmp_format({
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
    end)
  end)
end)

---------------------------
-- mfussenegger/nvim-dap --
---------------------------
ifPresent('dap', function(dap)
  map('n', '<F7>', ":lua require'dap'.step_out()<CR>")
  map('n', '<F8>', ":lua require'dap'.continue()<CR>")
  map('n', '<F9>', ":lua require'dap'.step_over()<CR>")
  map('n', '<S-F9>', ":lua require'dap'.step_into()<CR>")
  map('n', '<Space>b', ":lua require'dap'.toggle_breakpoint()<CR>")
  map('n', '<Space>B', ":lua require'dap'.set_breakpoint(vim.fn.input('Breakpoint condition: '))<CR>")
  map('n', '<Space>lp', ":lua require'dap'.set_breakpoint(nil, nil, vim.fn.input('Log point message: '))<CR>")
  map('n', '<Space>dr', ":lua require'dap'.repl.open()<CR>")
  map('n', '<Space>dl', ":lua require'dap'.run_last()<CR>")

  vim.fn.sign_define('DapBreakpoint', { text = 'ß', texthl = '', linehl = '', numhl = '' })
  vim.fn.sign_define('DapBreakpointCondition', { text = 'ü', texthl = '', linehl = '', numhl = '' })
  vim.fn.sign_define('DapStopped', { text = 'ඞ', texthl = 'Error' })

  ifPresent('dapui', function(dapui)
    dapui.setup()

    -- auto open/close dapui
    dap.listeners.after.event_initialized['dapui_config'] = function()
      dapui.open()
    end
    dap.listeners.before.event_terminated['dapui_config'] = function()
      dapui.close()
    end
    dap.listeners.before.event_exited['dapui_config'] = function()
      dapui.close()
    end
  end)

  ifPresent('nvim-dap-virtual-text', function(dap_virtual_text)
    dap_virtual_text.setup()
  end)

  dap.adapters.lldb = {
    type = 'executable',
    command = '/usr/bin/lldb-vscode',
    name = 'lldb',
  }

  dap.configurations.rust = {
    {
      name = 'Launch',
      type = 'lldb',
      request = 'launch',
      program = function()
        return vim.fn.input('Path to executable: ', vim.fn.getcwd() .. '/', 'file')
      end,
      cwd = '${workspaceFolder}',
      stopOnEntry = false,
      args = {},
      runInTerminal = false,
    },
    {
      name = 'Attach to process',
      type = 'lldb',
      request = 'attach',
      pid = require('dap.utils').pick_process,
      args = {},
    },
  }
end)

-------------------------------------
-- nvim-treesitter/nvim-treesitter --
-------------------------------------
ifPresent('nvim-treesitter.configs', function(nvim_treesitter)
  nvim_treesitter.setup({
    ensure_installed = {
      'html',
      'css',
      'javascript',
      'typescript',
      'tsx',
      'json',
      'jsonc',
      'kotlin',
      'java',
      'lua',
      'vim',
      'rust',
      'hcl',
      'toml',
    },
    highlight = {
      enable = true,
    },
    indent = {
      enable = true,
    },
    incremental_selection = {
      enable = false,
    },
    textobjects = {
      enable = false,
    },
    -- enable ts_context_commentstring
    context_commentstring = {
      enable = true,
      enable_autocmd = false,
    },
    rainbow = {
      enable = true,
      extended_mode = false,
      max_file_lines = 5000,
    },
  })

  -- enabled folding with treesitter
  -- opt.foldmethod = 'expr'
  -- opt.foldexpr = 'nvim_treesitter#foldexpr()'

  --------------------------------
  -- lewis6991/spellsitter.nvim --
  --------------------------------
  ifPresent('spellsitter', function(spellsitter)
    spellsitter.setup({
      enable = true,
      hl = 'SpellBad',
      spellchecker = 'vimfn',
    })
  end)
end)

-----------------------
-- vim-test/vim-test --
-----------------------
map('n', 'tt', ':TestNearest<CR>')
map('n', 'tf', ':TestFile<CR>')
map('n', 'ts', ':TestSuite<CR>')
map('n', 't_', ':TestLast<CR>')

-- work around to set config
-- cmd('let g:test = {}')
local tmp = g.test or {}

-- settings
tmp.strategy = 'neovim'
tmp.neovim = 'vertical'

g.test = tmp

-----------------------------
-- lewis6991/gitsigns.nvim --
-----------------------------
require('gitsigns').setup()

------------
-- Stylua --
------------
require('eratio.stylua')

-------------------------------
-- Enable global status line --
-------------------------------
opt.laststatus = 3 -- 3 mean global status lines
cmd([[highlight WinSeparator guibg=None]])

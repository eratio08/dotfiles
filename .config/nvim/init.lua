-- Mono-File Configuration --

--------------
-- Preamble --
--------------
local utils = require('eratio.utils')
local g = vim.g
local cmd = vim.cmd
local opt = vim.opt -- to set options
local map = utils.map
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
  vim.fn.execute('!git clone https://github.com/wbthomason/packer.nvim ' .. packer_path)
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

      -- Completion
      use('hrsh7th/nvim-cmp')
      use('hrsh7th/cmp-nvim-lsp')
      use('hrsh7th/cmp-nvim-lua')
      use('hrsh7th/cmp-buffer')
      -- use('hrsh7th/cmp-path')
      use('hrsh7th/cmp-cmdline')
      use('hrsh7th/cmp-emoji')
      use('onsails/lspkind-nvim')

      -- Snippets
      use('L3MON4D3/LuaSnip')
      use('saadparwaiz1/cmp_luasnip')
      use('rafamadriz/friendly-snippets')

      -- Telescope
      use({ 'nvim-telescope/telescope.nvim', requires = { 'nvim-lua/plenary.nvim' } })
      use('nvim-telescope/telescope-fzy-native.nvim')
      use('nvim-telescope/telescope-file-browser.nvim')

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
cmd([[syntax on]]) -- enabled syntax highlighting
opt.tabstop = 2 -- set tab width to 2 spaces
opt.softtabstop = 2 -- spaces inserted for a tab
opt.shiftwidth = 2 -- indentation width to 2 spaces
opt.expandtab = true -- replace tabs with spaces on insert
opt.cmdheight = 1 -- height of the message line at the bottom
opt.laststatus = 2 -- for lightline
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
map('n', '<space>wh', '<C-w>h') -- select left window
map('n', '<space>wj', '<C-w>j') -- select down window
map('n', '<space>wk', '<C-w>k') -- select up window
map('n', '<space>wl', '<C-w>l') -- select right window

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
ifPresent('lspconfig', function(_)
  local C = {}

  -- mappings
  map('n', 'gd', ':lua vim.lsp.buf.definition()<CR>')
  map('n', 'gi', ':lua vim.lsp.buf.implementation()<CR>')
  map('n', 'gsh', ':lua vim.lsp.buf.signature_help()<CR>')
  map('n', 'grr', ':lua vim.lsp.buf.references()<CR>')
  map('n', 'grn', ':lua vim.lsp.buf.rename()<CR>')
  map('n', 'gh', ':lua vim.lsp.buf.hover()<CR>')
  map('n', 'gca', ':lua vim.lsp.buf.code_action()<CR>')
  map('n', 'ge', ':lua vim.lsp.diagnostic.show_line_diagnostics()<CR>')
  map('n', ']e', ':lua vim.lsp.diagnostic.goto_next()<CR>')
  map('n', '[e', ':lua vim.lsp.diagnostic.goto_prev()<CR>')

  map('n', 'gdc', ':lua vim.lsp.buf.declaration()<CR>')
  map('n', 'gtd', ':lua vim.lsp.buf.type_definition()<CR>')

  -- work space files
  map('n', '<space>awf', ':lua vim.lsp.buf.add_workspace_folder()<CR>')
  map('n', '<space>rwf', ':lua vim.lsp.buf.remove_workspace_folder()<CR>')
  map('n', '<space>swf', ':lua print(vim.inspect(vim.lsp.buf.list_workspace_folders()))<CR>')

  -- trigger formatting
  map('n', '<space>ll', ':lua vim.lsp.buf.formatting()<CR>')

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
      'kt',
      'java',
      'lua',
      'html',
      'vue',
      'json',
      'py',
      'tf',
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

  C.kotlin_language_server = config({})

  C.elm = config({
    init_options = {
      elmReviewDiagnostics = 'warning',
    },
  })

  C.rust_analyzer = config({})

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

  C.tailwindcss = config()

  C.volar = config()

  C.pyright = config()

  C.pylsp = config()

  C.terraform_lsp = config()

  C.tflint = config()

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
end)

----------------------------------
-- nvim-lua/lsp_extensions.nvim --
----------------------------------
ifPresent('lsp_extensions', function(_)
  local extensions = '*.rs'
  augroup({
    {
      'InsertLeave,BufEnter,BufWinEnter,TabEnter,BufWritePost',
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
  map('n', '<Space>ff', ':Telescope find_files<CR>')
  map('n', '<Space>fg', ':Telescope live_grep<CR>')
  map('n', '<Space>fb', ':Telescope buffers<CR>')

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
  map('n', 'gle', '<cmd>Telescope diagnostics<CR>')

  telescope.setup({
    extensions = {
      fzy_native = {
        override_generic_sorter = false,
        override_file_sorter = true,
      },
      file_browser = {
        theme = 'ivy',
        mappings = {
          ['i'] = {
            -- your custom insert mode mappings
          },
          ['n'] = {
            -- your custom normal mode mappings
          },
        },
      },
    },
    defaults = {
      -- setting here
      prompt_prefix = '> ',
      color_devicons = true,
    },
  })

  -- Load telescope helpers
  require('eratio.telescope-helpers')

  -- load native fyz plugin
  telescope.load_extension('fzy_native')
  telescope.load_extension('file_browser')
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

----------------------
-- L3MON4D3/LuaSnip --
----------------------
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
      lualine_c = { 'filename' },
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
  local luasnip = require('luasnip')

  cmp.setup({
    snippet = {
      expand = function(args)
        luasnip.lsp_expand(args.body)
      end,
    },
    mapping = {
      ['<C-b>'] = cmp.mapping(cmp.mapping.scroll_docs(-4), { 'i', 'c' }),
      ['<C-f>'] = cmp.mapping(cmp.mapping.scroll_docs(4), { 'i', 'c' }),
      ['<C-Space>'] = cmp.mapping(cmp.mapping.complete(), { 'i', 'c' }),
      ['<C-e>'] = cmp.mapping({
        i = cmp.mapping.abort(),
        c = cmp.mapping.close(),
      }),
      ['<CR>'] = cmp.mapping.confirm({
        behavior = cmp.ConfirmBehavior.Replace,
        select = true,
      }),
      ['<Tab>'] = function(fallback)
        if cmp.visible() then
          cmp.select_next_item()
        elseif luasnip.expand_or_jumpable() then
          luasnip.expand_or_jump()
        else
          fallback()
        end
      end,
      ['<S-Tab>'] = function(fallback)
        if cmp.visible() then
          cmp.select_prev_item()
        elseif luasnip.jumpable(-1) then
          luasnip.jump(-1)
        else
          fallback()
        end
      end,
    },
    sources = cmp.config.sources({
      { name = 'nvim_lua' },
      { name = 'nvim_lsp' },
      { name = 'luasnip' },
    }, {
      { name = 'emoji' },
      { name = 'buffer', keyword_length = 5, max_item_count = 10 },
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
    }, {
      { name = 'cmdline' },
    }),
  })

  --------------------------
  -- onsails/lspkind-nvim --
  --------------------------
  ifPresent('lspkind', function(lspkind)
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
  end)
end)

---------------------------
-- mfussenegger/nvim-dap --
---------------------------
ifPresent('dap', function(_)
  -- TODO: Properly setup DAP
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
      'json',
      'jsonc',
      'kotlin',
      'java',
      'lua',
      'vim',
      'rust',
      'hcl',
    },
    highlight = {
      enable = true,
    },
    indent = {
      enable = true,
    },
    incremental_selection = {
      enable = false,
      -- keymaps = {
      --   init_selection = "<Space>is",
      --   node_incremental = "<Space>sn",
      --   node_decremental = "<Space>snd",
      --   scope_incremental = "<Space>ss",
      -- },
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
  opt.foldmethod = 'expr'
  opt.foldexpr = 'nvim_treesitter#foldexpr()'

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

------------
-- Stylua --
------------
require('eratio.stylua')

-------------
-- Prelude --
-------------
local utils     = require('eratio.utils')
local ifPresent = utils.ifPresent
local g         = vim.g
local cmd       = vim.cmd
local opt       = vim.opt
local map       = vim.keymap.set

--------------------
-- Install packer --
--------------------
local install_path = vim.fn.stdpath('data') .. '/site/pack/packer/start/packer.nvim'
local is_bootstrap = false
if vim.fn.empty(vim.fn.glob(install_path)) > 0 then
  is_bootstrap = true
  vim.fn.execute('!git clone --depth=1 https://github.com/wbthomason/packer.nvim' .. install_path)
  vim.cmd([[packadd packer.nvim]])
end

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
      use('klen/nvim-test')

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
      use('williamboman/mason-lspconfig.nvim')
      use('williamboman/mason.nvim')
      use('nvim-lua/lsp_extensions.nvim')
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
      use({ 'ray-x/cmp-treesitter', after = 'nvim-cmp' })

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
      -- use({ 'tami5/vlang.nvim', requires = { 'cheap-glitch/vim-v', 'nvim-lua/plenary.nvim' } })

      -- EdgeDB
      use('edgedb/edgedb-vim')

      if is_bootstrap then
        require('packer').sync()
      end
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

----------------------------------
-- Restart vim if bootstrapping --
----------------------------------
if is_bootstrap then
  print('==================================')
  print('    Plugins are being installed')
  print('    Wait until Packer completes,')
  print('       then restart nvim')
  print('==================================')
  return
end

-- Automatically source and re-compile packer whenever you save this init.lua
local packer_group = vim.api.nvim_create_augroup('Packer', { clear = true })
vim.api.nvim_create_autocmd('BufWritePost', {
  command = 'source <afile> | PackerCompile',
  group = packer_group,
  pattern = vim.fn.expand('$MYVIMRC'),
})

--------------
-- Settings --
--------------
opt.tabstop          = 2 -- set tab width to 2 spaces
opt.softtabstop      = 2 -- spaces inserted for a tab
opt.shiftwidth       = 2 -- indentation width to 2 spaces
opt.expandtab        = true -- replace tabs with spaces on insert
opt.cmdheight        = 1 -- height of the message line at the bottom
opt.updatetime       = 250 -- time until vim updates the frame, time for combined commands
vim.wo.signcolumn    = 'yes' -- always show sign columns
vim.wo.number        = true -- show line numbers
opt.relativenumber   = true -- enable relative line numbers
opt.swapfile         = false -- disable swap files
opt.backup           = false -- no backup files
opt.hlsearch         = false -- highlight all search results
opt.writebackup      = false -- turn of backup when overwriting files
opt.errorbells       = false -- disable the error bells
-- opt.wrap = false -- disable wrapping
vim.o.breakindent    = true -- indent wrapped lines
opt.ignorecase       = true -- search case insensitive by default
opt.smartcase        = true -- if capital letter is used be case sensitive
opt.incsearch        = true -- sow search results immediately
opt.spell            = true -- set spell checking language to en_us
opt.spelllang        = 'en_us'
opt.smartindent      = true -- enable auto indentation on next line
opt.wildmenu         = true -- enable wild match window
opt.wildmode         = { 'longest', 'list', 'full' } -- Nice menu when typing `:find ...`
opt.hidden           = true -- keep buffers on navigation
opt.background       = 'dark' -- opt.background color brightness
opt.undofile         = true -- enable undo file
opt.scrolloff        = 10 --- opt.undo file location- add scroll offset
opt.colorcolumn      = { 80, 120 } -- vertical marker at column
opt.list             = true -- show invisible characters
opt.listchars        = 'tab:▸\\,space:·,eol:,trail:_'
opt.guicursor        = '' -- disable cursor styles
opt.termguicolors    = true -- disable to prevent tmux overlay
opt.splitright       = true -- horizontal split windows to the right
opt.splitbelow       = true -- vertical split windows to below
opt.splitright       = true -- split to the right
opt.foldenable       = false -- unfold all by default
opt.fixendofline     = true
opt.mouse            = 'a' -- enable mouse support for all modes
opt.completeopt      = { 'menuone', 'noselect' } -- show auto completion menu even for single item
opt.shada            = { '!', "'1000", '<50', 's10' } -- set shared data saving, global upper case variables, 1000 marks, 50 lines per register, max 10KiB
g.do_filetype_lua    = 1
vim.g.mapleader      = ' '
vim.g.maplocalleader = ' '
opt.shortmess:append('c') -- don't give |ins-completion-menu| messages
opt.path:append('**') -- enable vim-native fuzzy find
opt.isfname:append('@-@') -- opt.how files names are displayed
opt.diffopt:append('vertical') -- diff windows split to vertical
opt.wildignore:append({
  '*.pyc',
  '*_build/*',
  '**/coverage/*',
  '**/node_modules/*',
  '**/android/*',
  '**/ios/*',
  '**/.git/*',
}) -- Ignore files when wild card matching

--------------
-- Commands --
--------------
-- Highlight on yank
local highlight_group = vim.api.nvim_create_augroup('YankHighlight', { clear = true })
vim.api.nvim_create_autocmd('TextYankPost', {
  callback = function()
    vim.highlight.on_yank()
  end,
  group = highlight_group,
  pattern = '*',
})

--------------
-- Mappings --
--------------
map({ 'n', 'v' }, '<Space>', '<Nop>', { silent = true }) -- better default experience
map('n', 'k', "v:count == 0 ? 'gk' : 'k'", { expr = true, silent = true }) -- Remap for dealing with word wrap
map('n', 'j', "v:count == 0 ? 'gj' : 'j'", { expr = true, silent = true }) -- Remap for dealing with word wrap

map('c', 'HR', 'vert bo h', { desc = 'Open Help Vertical' }) -- open help in vertical split
map('n', '<space>s', '1z=', { desc = 'Fix spelling' }) -- Replace spelling mistake with first match
map('n', '<space>pv', ':wincmd v<bar> :Ex <bar> :vertical resize 30<CR>', { desc = 'Open Explorer in vertical Split' }) -- open explorer in vertical split
map('c', '%%', "<C-R>=fnameescape(expand('%:h')).'/'<CR>", { desc = 'Replace %% with PWD' }) -- open to edit helpers - expand %% to current working directory
map('n', '<space>ew', ':e %%', { desc = 'Edit in new Buffer' }) -- edit in new window
map('n', '<space>es', ':sp %%', { desc = 'Edit in horizontal Split' }) -- edit in new split
map('n', '<space>ev', ':vsp %%', { desc = 'Edit in vertical Split' }) -- edit in new vertical split
map('n', '<space>et', ':tabe %%', { desc = 'Edit in new Tab' }) -- edit in new tab
map('n', '"*', ':call system("wl-copy", @")<CR>', { desc = 'Copy to Clipboard' }) -- copy to clipboard for wayland
map('v', '"*', ':call system("wl-copy", @")<CR>', { desc = 'Copy to Clipboard' }) -- copy to clipboard for wayland

-- move single line down
map('n', '<A-j>', 'ddp', { desc = 'Move line down' })
map('v', '<A-j>', 'xp`[V`]', { desc = 'Move Selection down' })
-- move single line up
map('n', '<A-k>', 'ddkP', { desc = 'Move line up' })
map('v', '<A-k>', 'xkP`[V`]', { desc = 'Move Selection up' })

-- disable arrow keys
map('n', '<Up>', '<Nop>')
map('n', '<Down>', '<Nop>')
map('n', '<Left>', '<Nop>')
map('n', '<Right>', '<Nop>')

-- diagnostics
map('n', '[d', vim.diagnostic.goto_prev, { desc = 'Go to next diagnostic' })
map('n', ']d', vim.diagnostic.goto_next, { desc = 'Go to previous diagnostic' })
map('n', '<leader>e', vim.diagnostic.open_float, { desc = 'List diagnostics' })
map('n', '<leader>q', vim.diagnostic.setloclist, { desc = 'Add diagnostics to Quicklist' })

-----------
-- netrw --
-----------
-- enable native netrw plugin
vim.cmd('filetype plugin indent on')
g.netrw_liststyle     = 3 -- open netrw in tree mode
g.netrw_banner        = 0 -- remove banner from netrw
g.netrw_browser_split = 0 -- reuse curent window when opening netrw
-- g.netrw_browse_split = 4 -- keep netrw open
g.netrw_winsize       = 25 -- set initial windows size
g.netrw_altv          = 1 -- view on the left
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

  -- augroup for auto-formatting
  local autoformat_group = vim.api.nvim_create_augroup('LspAutoFormat', { clear = true })

  -- ON-ATTACH
  local on_attach = function(_, bufnr)
    local nmap = function(keys, func, desc)
      if desc then
        desc = 'LSP: ' .. desc
      end

      vim.keymap.set('n', keys, func, { buffer = bufnr, desc = desc })
    end

    -----------------
    -- lsp keymaps --
    -----------------
    nmap('<leader>rn', vim.lsp.buf.rename, '[R]e[n]ame')
    nmap('<leader>ca', vim.lsp.buf.code_action, '[C]ode [A]tion')
    nmap('gd', vim.lsp.buf.definition, '[G]oto [D]efinition')
    nmap('gi', vim.lsp.buf.implementation, '[G]oto [I]mplementation')
    nmap('gr', require('telescope.builtin').lsp_references)
    nmap('<leader>ds', require('telescope.builtin').lsp_document_symbols, '[D]ocument [S]ymbols')
    nmap('<leader>ws', require('telescope.builtin').lsp_dynamic_workspace_symbols, '[W]orkspace [S]ymbols')
    nmap('K', vim.lsp.buf.hover, 'Hover Documentation')
    nmap('<C-k>', vim.lsp.buf.signature_help, 'Signature Documentation')

    nmap('gD', vim.lsp.buf.declaration, '[G]oto [D]eclaration')
    nmap('<leader>D', vim.lsp.buf.type_definition, 'Type Definition')

    -- workspace
    nmap('<leader>wa', vim.lsp.buf.add_workspace_folder, '[W]orkspace [A]dd Folder')
    nmap('<leader>wr', vim.lsp.buf.remove_workspace_folder, '[W]orkspace [R]emove Folder')
    nmap('<leader>wl', function()
      print(vim.inspect(vim.lsp.buf.list_workspace_folders()))
    end, '[W]orkspace [L]ist Folders')

    -- trigger formatting
    nmap('<leader>ll', ':Format<CR>', 'Fromat Buffer')

    -- Create a command `:Format` local to the LSP buffer
    vim.api.nvim_buf_create_user_command(
      bufnr,
      'Format',
      vim.lsp.buf.format or vim.lsp.buf.formatting,
      { desc = 'Format current buffer with LSP' }
    )

    -- Auto-format in save
    vim.api.nvim_clear_autocmds({ group = autoformat_group, buffer = bufnr })
    vim.api.nvim_create_autocmd('BufWritePre', {
      group = autoformat_group,
      buffer = bufnr,
      callback = function() vim.lsp.buf.format({ bufnr = bufnr }) end
    })
  end

  -- nvim-cmp supports additional completion capabilities
  local capabilities = require('cmp_nvim_lsp').update_capabilities(vim.lsp.protocol.make_client_capabilities())

  -- set default configuration
  lspconfig.util.default_config = vim.tbl_extend(
    'force', {
      on_attach = on_attach,
      capabilities = capabilities,
    }, lspconfig.util.default_config
  )

  ------------------------------------------------
  -- custom configurations for language servers --
  ------------------------------------------------
  -- Make runtime files discoverable to the server
  local runtime_path = vim.split(package.path, ';')
  table.insert(runtime_path, 'lua/?.lua')
  table.insert(runtime_path, 'lua/?/init.lua')

  local S = {}
  S.sumneko_lua = {
    settings = {
      -- https://github.com/sumneko/lua-language-server/blob/master/locale/en-us/setting.lua
      Lua = {
        runtime = {
          version = 'LuaJIT',
          path = runtime_path,
        },
        diagnostics = {
          globals = { 'vim' },
        },
        -- workspace = { library = vim.api.nvim_get_runtime_file('', true) },
        telemetry = {
          enable = false,
        },
        format = {
          enable = true,
          defaultConfig = {
            -- https://github.com/CppCXY/EmmyLuaCodeStyle/blob/master/docs/format_config_EN.md
            indent_style = 'space',
            indent_size = '2',
            call_arg_parentheses = 'keep',
            quote_style = 'single',
            continuous_assign_statement_align_to_equal_sign = 'true',
            continuous_assign_table_field_align_to_equal_sign = 'false'
          }
        },
      },
    },
  }
  S.tsserver = {
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
  }
  S.kotlin_language_server = {}
  S.elmls = {
    init_options = {
      elmReviewDiagnostics = 'warning',
    },
  }
  S.rust_analyzer = {
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
  }
  S.eslint = {
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
  }
  S.tailwindcss = {
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
  }
  S.volar = {}
  S.pyright = {}
  S.pylsp = {}
  S.terraform_lsp = {}
  S.tflint = {}
  S.taplo = {}
  S.yamlls = {}
  S.dockerls = {}
  S.vls = {
    cmd = { '/usr/local/bin/vls' },
  }

  -----------------------------
  -- williamboman/mason.nvim --
  -----------------------------
  ifPresent('mason', function(mason)
    mason.setup()
  end)

  ---------------------------------------
  -- williamboman/mason-lspconfig.nvim --
  ---------------------------------------
  ifPresent('mason-lspconfig', function(mason_lspconfig)
    mason_lspconfig.setup({
      ensure_installed = utils.keys(S),
      automatic_installation = true
    })
  end)

  -----------------------
  -- setup all servers --
  -----------------------
  for server, conf in pairs(S) do
    lspconfig[server].setup(conf)
  end

  -----------------------
  -- j-hui/fidget.nvim --
  -----------------------
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
ifPresent('lsp_extensions', function(lsp_extensions)
  local group = vim.api.nvim_create_augroup('RustInlayHint', { clear = true })
  vim.api.nvim_create_autocmd('InsertLeave,BufWritePost', {
    callback = function()
      lsp_extensions.inlay_hints({ prefix = ' » ', highlight = 'Comment' })
    end,
    group = group,
    pattern = '*.rs',
  })
end)

-----------------------------------
-- nvim-telescope/telescope.nvim --
-----------------------------------
ifPresent('telescope', function(telescope)
  local telescope_builtin = require('telescope.builtin')

  -- find in files or buffer
  map('n', '<leader>?', telescope_builtin.oldfiles, { desc = '[?] Find recently opened files' })
  map('n', '<leader><space>', telescope_builtin.buffers, { desc = '[ ] Find existing buffers' })
  map('n', '<leader>/', function()
    telescope_builtin.current_buffer_fuzzy_find(require('telescope.themes').get_dropdown({
      winblend = 10,
      previewer = false,
    }))
  end, {
    desc = '[/] Fuzzily search in current buffer]',
  })
  map('n', '<leader>sf', telescope_builtin.find_files, { desc = '[S]earch [F]iles' })
  map('n', '<leader>sw', telescope_builtin.grep_string, { desc = '[S]earch current [W]ord' })
  map('n', '<leader>sg', telescope_builtin.live_grep, { desc = '[S]earch by [G]rep' })
  map('n', '<leader>s.', telescope_builtin.resume, { desc = 'Resume Search' })
  map('n', '<leader>,', function()
    telescope_builtin.find_files({
      prompt_title = '<NVim Settings>',
      cwd = '~/.config/nvim',
    })
  end, {
    desc = 'Settings',
  })

  -- git
  map('n', '<leader>gs', telescope_builtin.git_status, { desc = 'Search [G]it [S]tatus' })
  map('n', '<leader>gc', ':Telescope git_commits<CR>', { desc = 'Search [G]it [C]ommits' })
  map('n', '<leader>gb', ':Telescope git_branches<CR>', { desc = 'Search [G]it [B]ranches' })

  -- find in vim
  map('n', '<leader>sh', telescope_builtin.help_tags, { desc = '[S]earch [H]elp' })
  map('n', '<leader>so', telescope_builtin.vim_options, { desc = '[S]earch Vim [O]ptions' })
  map('n', '<leader>sc', telescope_builtin.commands, { desc = '[S]earch [C]ommands' })
  map('n', '<leader>sk', telescope_builtin.keymaps, { desc = '[S]earch [K]eymaps' })

  -- file browser
  map('n', '<leader>bb', function()
    telescope.extensions.file_browser.file_browser({ path = '%:p:h' })
  end, {
    desc = 'Open File Browser',
  })

  -- diagnostics
  map('n', '<leader>sd', telescope_builtin.diagnostics, { desc = '[S]earch [D]iagnostics' })

  telescope.setup({
    defaults = {
      -- setting here
      prompt_prefix = '> ',
      color_devicons = true,
      mappings = {
        i = {
          ['<C-u>'] = false,
          ['<C-d>'] = false,
        },
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
      },
      ['ui-select'] = {
        require('telescope.themes').get_dropdown({}),
      },
    },
  })

  -- plugins
  telescope.load_extension('fzy_native')
  telescope.load_extension('file_browser')
  telescope.load_extension('dap')
  telescope.load_extension('ui-select')
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
        ['<CR>'] = cmp.mapping.confirm({
          behavior = cmp.ConfirmBehavior.Replace,
          select = true,
        }),
        ['<Tab>'] = cmp.mapping(function(fallback)
          local has_words_before = function()
            local line, col = unpack(vim.api.nvim_win_get_cursor(0))
            return col ~= 0 and vim.api.nvim_buf_get_lines(0, line - 1, line, true)[1]:sub(col, col):match('%s') == nil
          end

          if cmp.visible() then
            cmp.select_next_item()
          elseif luasnip.expand_or_locally_jumpable() then
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
        { name = 'emoji' },
        { name = 'nvim_lsp' },
        { name = 'luasnip' },
        { name = 'treesitter', keyword_length = 2 },
        { name = 'buffer', keyword_length = 2 },
        { name = 'nvim_lua' },
      }),
      experimental = {
        ghost_text = true,
      },
    })

    -- Bind sources to `/`.
    cmp.setup.cmdline('/', {
      mapping = cmp.mapping.preset.cmdline(),
      sources = cmp.config.sources({
        { name = 'path', max_item_count = 20 },
        { name = 'buffer', max_item_count = 20 },
      }),
    })

    -- Bind sources to ':'.
    cmp.setup.cmdline(':', {
      mapping = cmp.mapping.preset.cmdline(),
      sources = cmp.config.sources({
        { name = 'cmdline' },
        { name = 'path', max_item_count = 20 },
      }),
    })

    cmp.setup.filetype('gitcommit', {
      sources = cmp.config.sources({
        { name = 'emoji' },
        { name = 'cmp_git' },
        { name = 'buffer' },
      }),
    })

    -- setup L3MON4D3/LuaSnip
    local types = require('luasnip.util.types')
    luasnip.config.set_config({
      ext_opts = {
        [types.choiceNode] = {
          active = {
            virt_text = { { 'ﲑ', 'Error' } },
          },
        },
      },
    })
    vim.keymap.set({ 'i' }, '<C-l>', function()
      if luasnip.choice_active() then
        luasnip.change_choiche(1)
      end
    end)

    -- load vscode extension style snippets
    -- currently: rafamadriz/friendly-snippets
    require('luasnip.loaders.from_vscode').lazy_load()

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
  map('n', '<F8>', ":lua require'dap'.step_over()<CR>", { desc = 'Step Over' })
  map('n', '<F7>', ":lua require'dap'.step_into()<CR>", { desc = 'Step Into' })
  map('n', '<S-F7>', ":lua require'dap'.step_out()<CR>", { desc = 'Step Out' })
  map('n', '<F9>', ":lua require'dap'.continue()<CR>", { desc = 'Continue' })
  map('n', '<Space>b', ":lua require'dap'.toggle_breakpoint()<CR>", { desc = 'Toggle Breakpoint' })
  map('n', '<Space>B', ":lua require'dap'.set_breakpoint(vim.fn.input('Breakpoint condition: '))<CR>",
    { desc = 'Set Conditional Breakpoint' })
  map('n', '<Space>lp', ":lua require'dap'.set_breakpoint(nil, nil, vim.fn.input('Log point message: '))<CR>",
    { desc = 'Set Log-Breakpoint' })
  map('n', '<Space>dr', ":lua require'dap'.repl.open()<CR>", { desc = 'Open REPL' })
  map('n', '<Space>dl', ":lua require'dap'.run_last()<CR>", { desc = 'Run Last' })

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
      enable = true,
      keymaps = {
        init_selection = '<c-space>',
        node_incremental = '<c-space>',
        -- TODO: I'm not sure for this one.
        -- scope_incremental = '<c-s>',
        node_decremental = '<c-backspace>',
      },
    },
    textobjects = {
      select = {
        enable = true,
        lookahead = true, -- Automatically jump forward to textobj, similar to targets.vim
        keymaps = {
          -- You can use the capture groups defined in textobjects.scm
          ['af'] = '@function.outer',
          ['if'] = '@function.inner',
          ['ac'] = '@class.outer',
          ['ic'] = '@class.inner',
        },
      },
      move = {
        enable = true,
        set_jumps = true, -- whether to set jumps in the jumplist
        goto_next_start = {
          [']m'] = '@function.outer',
          [']]'] = '@class.outer',
        },
        goto_next_end = {
          [']M'] = '@function.outer',
          [']['] = '@class.outer',
        },
        goto_previous_start = {
          ['[m'] = '@function.outer',
          ['[['] = '@class.outer',
        },
        goto_previous_end = {
          ['[M'] = '@function.outer',
          ['[]'] = '@class.outer',
        },
      },
      swap = {
        enable = true,
        swap_next = {
          ['<leader>a'] = '@parameter.inner',
        },
        swap_previous = {
          ['<leader>A'] = '@parameter.inner',
        },
      },
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

--------------------
-- klen/nvim-test --
--------------------
ifPresent('nvim-test', function(nvim_test)
  map('n', 'tt', ':TestNearest<CR>')
  map('n', 'tf', ':TestFile<CR>')
  map('n', 'ts', ':TestSuite<CR>')
  map('n', 't_', ':TestLast<CR>')

  nvim_test.setup()

  -- require('nvim-test.runners.vitest'):setup({
  --   command = '~/node_modules/.bin/vitest',
  --   args = {},
  --   env = {},
  --
  --   file_pattern = '.*|(spec|test))\\.(js|jsx|coffee|ts|tsx)$',
  --   ind_files = { '{name}.test.{ext}', '{name}.spec.{ext}' },
  --
  --   filename_modifier = nil,
  --   working_directory = nil,
  -- })
end)

-----------------------------
-- lewis6991/gitsigns.nvim --
-----------------------------
ifPresent('gitsigns', function(gitsigns)
  gitsigns.setup({
    signs = {
      add = { text = '+' },
      change = { text = '~' },
      delete = { text = '_' },
      topdelete = { text = '‾' },
      changedelete = { text = '~' },
    },
  })
end)

-----------------------------------------
-- lukas-reineke/indent-blankline.nvim --
-----------------------------------------
-- Indent blankline
ifPresent('indent_blankline', function(indent_blankline)
  indent_blankline.setup({
    char = '┊',
    show_trailing_blankline_indent = false,
  })
end)

-------------------------------
-- Enable global status line --
-------------------------------
opt.laststatus = 3 -- 3 mean global status lines
cmd([[highlight WinSeparator guibg=None]])

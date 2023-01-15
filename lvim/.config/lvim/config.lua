-- lvim settings
lvim.log.level          = "warn"
lvim.colorscheme        = "rose-pine"
lvim.transparent_window = true
lvim.leader             = "space"
lvim.format_on_save     = true

-- nvim settings
vim.opt.relativenumber = true -- relative line number
vim.opt.spell          = false -- enable spellign
vim.opt.expandtab      = true -- replace tabs with spaces on insert
vim.opt.list           = true -- show invisible characters
vim.opt.listchars      = 'tab:🢒🢒,space:·,eol:,trail:_'
vim.opt.showmode       = false
vim.opt.showtabline    = 0
vim.opt.expandtab      = true -- convert tabs to spaces
vim.opt.tabstop        = 2 -- set tab width to 2 spaces
vim.opt.softtabstop    = 2 -- spaces inserted for a tab
vim.opt.shiftwidth     = 2 -- indentation width to 2 spaces
vim.opt.clipboard      = '' -- do not use unnamed register for clipboard
vim.opt.smartindent    = true -- enable auto indentation on next line
vim.opt.autochdir      = true
vim.opt.hlsearch       = false

-- add your own keymapping
-- lvim.keys.normal_mode['<space>s'] = '1z=' -- Replace spelling mistake with first match
lvim.keys.normal_mode['<Up>'] = '<Nop>'
lvim.keys.normal_mode['<Down>'] = '<Nop>'
lvim.keys.normal_mode['<Left>'] = '<Nop>'
lvim.keys.normal_mode['<Right>'] = '<Nop>'
lvim.keys.insert_mode['<Up>'] = '<Nop>'
lvim.keys.insert_mode['<Down>'] = '<Nop>'
lvim.keys.insert_mode['<Left>'] = '<Nop>'
lvim.keys.insert_mode['<Right>'] = '<Nop>'

-- lvim.keys.normal_mode["<S-l>"] = ":BufferLineCycleNext<CR>"
-- lvim.keys.normal_mode["<S-h>"] = ":BufferLineCyclePrev<CR>"
-- unmap a default keymapping
-- vim.keymap.del("n", "<C-Up>")
-- override a default keymapping
-- lvim.keys.normal_mode["<C-q>"] = ":q<cr>" -- or vim.keymap.set("n", "<C-q>", ":q<cr>" )

-- Change Telescope navigation to use j and k for navigation and n and p for history in both input and normal mode.
-- we use protected-mode (pcall) just in case the plugin wasn't loaded yet.
-- local _, actions = pcall(require, "telescope.actions")
-- lvim.builtin.telescope.defaults.mappings = {
--   -- for input mode
--   i = {
--     ["<C-j>"] = actions.move_selection_next,
--     ["<C-k>"] = actions.move_selection_previous,
--     ["<C-n>"] = actions.cycle_history_next,
--     ["<C-p>"] = actions.cycle_history_prev,
--   },
--   -- for normal mode
--   n = {
--     ["<C-j>"] = actions.move_selection_next,
--     ["<C-k>"] = actions.move_selection_previous,
--   },
-- }

-- Use which-key to add extra bindings with the leader-key prefix
lvim.builtin.which_key.mappings["P"] = { "<cmd>Telescope projects<CR>", "Projects" }
lvim.builtin.which_key.mappings["t"] = {
  name = "+Trouble",
  r = { "<cmd>Trouble lsp_references<cr>", "References" },
  f = { "<cmd>Trouble lsp_definitions<cr>", "Definitions" },
  d = { "<cmd>Trouble document_diagnostics<cr>", "Diagnostics" },
  q = { "<cmd>Trouble quickfix<cr>", "QuickFix" },
  l = { "<cmd>Trouble loclist<cr>", "LocationList" },
  w = { "<cmd>Trouble workspace_diagnostics<cr>", "Workspace Diagnostics" },
}

-- User Config for predefined plugins
-- After changing plugin config exit and reopen LunarVim, Run :PackerInstall :PackerCompile
lvim.builtin.alpha.active                           = true
lvim.builtin.alpha.mode                             = "dashboard"
lvim.builtin.terminal.active                        = true
lvim.builtin.nvimtree.setup.view.side               = "left"
lvim.builtin.bufferline.active                      = false
-- lvim.builtin.lualine.sections.lualine_c             = { { 'filename', path = 1 } }
-- lvim.builtin.autopairs = false
lvim.builtin.nvimtree.setup.renderer.icons.show.git = true
lvim.builtin.treesitter.ensure_installed            = {
  "bash",
  -- "c",
  "javascript",
  "json",
  "lua",
  "python",
  "typescript",
  -- "tsx",
  "css",
  "rust",
  "java",
  "yaml",
  "go"
}

-- generic LSP settings
lvim.lsp.automatic_servers_installation = true
lvim.lsp.installer.setup.ensure_installed = {
  "sumneko_lua",
  "tsserver",
  "jsonls",
  "gopls",
  -- "golangci_lint_ls",
  "kotlin_language_server",
  "rust_analyzer",
  "eslint",
  "tailwindcss",
  "volar",
  "pyright",
  "pylsp",
  "tflint",
  "taplo",
  "yamlls",
  "dockerls",
  "vls",
}

-- -- set a formatter, this will override the language server formatting capabilities (if it exists)
local formatters = require "lvim.lsp.null-ls.formatters"
formatters.setup {
  { command = 'gofmt' },
  { command = "black", filetypes = { "python" } },
  { command = "isort", filetypes = { "python" } },
  {
    -- each formatter accepts a list of options identical to https://github.com/jose-elias-alvarez/null-ls.nvim/blob/main/doc/BUILTINS.md#Configuration
    command = "prettier",
    ---@usage arguments to pass to the formatter
    -- these cannot contain whitespaces, options such as `--line-width 80` become either `{'--line-width', '80'}` or `{'--line-width=80'}`
    extra_args = { "--print-with", "100" },
    ---@usage specify which filetypes to enable. By default a providers will attach to all the filetypes it supports.
    filetypes = { "typescript", "typescriptreact" },
  },
}

-- -- set additional linters
local linters = require "lvim.lsp.null-ls.linters"
linters.setup {
  { command = 'golangci_lint' },
  { command = "flake8", filetypes = { "python" } },
  {
    -- each linter accepts a list of options identical to https://github.com/jose-elias-alvarez/null-ls.nvim/blob/main/doc/BUILTINS.md#Configuration
    command = "shellcheck",
    ---@usage arguments to pass to the formatter
    -- these cannot contain whitespaces, options such as `--line-width 80` become either `{'--line-width', '80'}` or `{'--line-width=80'}`
    extra_args = { "--severity", "warning" },
  },
  {
    command = "codespell",
    ---@usage specify which filetypes to enable. By default a providers will attach to all the filetypes it supports.
    -- filetypes = { "javascript", "python" },
  },
}

-- Additional Plugins
lvim.plugins = {
  { "folke/trouble.nvim", cmd = "TroubleToggle" },
  -- { 'christianchiarulli/nvcode-color-schemes.vim' },
  { 'tpope/vim-unimpaired' },
  { 'TimUntersberger/neogit' },
  {
    "tpope/vim-fugitive",
    cmd = {
      "G",
      "Git",
      "Gdiffsplit",
      "Gread",
      "Gwrite",
      "Ggrep",
      "GMove",
      "GDelete",
      "GBrowse",
      "GRemove",
      "GRename",
      "Glgrep",
      "Gedit"
    },
    ft = { "fugitive" }
  },
  { "hrsh7th/cmp-emoji", config = function()
    table.insert(lvim.builtin.cmp.sources, 1, { name = "emoji" })
  end },
  { "rose-pine/neovim" },
}

lvim.builtin.which_key.mappings["t"] = {
  name = "Diagnostics",
  t = { "<cmd>TroubleToggle<cr>", "trouble" },
  w = { "<cmd>TroubleToggle workspace_diagnostics<cr>", "workspace" },
  d = { "<cmd>TroubleToggle document_diagnostics<cr>", "document" },
  q = { "<cmd>TroubleToggle quickfix<cr>", "quickfix" },
  l = { "<cmd>TroubleToggle loclist<cr>", "loclist" },
  r = { "<cmd>TroubleToggle lsp_references<cr>", "references" },
}

-- Autocommands (https://neovim.io/doc/user/autocmd.html)
-- vim.api.nvim_create_autocmd("BufEnter", {
--   pattern = { "*.json", "*.jsonc" },
--   -- enable wrap mode for json files only
--   command = "setlocal wrap",
-- })

vim.api.nvim_create_autocmd("FileType", {
  pattern = "zsh",
  callback = function()
    require("nvim-treesitter.highlight").attach(0, "bash")
  end,
})

vim.api.nvim_set_hl(0, "Normal", { bg = "none" })
vim.api.nvim_set_hl(0, "NormalFloat", { bg = "none" })

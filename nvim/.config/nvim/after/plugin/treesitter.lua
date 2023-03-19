require 'nvim-treesitter.configs'.setup {
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
    'go',
    'yaml',
  },
  sync_install = false,
  auto_install = true,
  ignore_install = {},
  highlight = {
    enable = true,
    disable = function (lang, buf)
      local max_filesize = 500 * 1024 -- 500 KB
      local ok, stats = pcall(vim.loop.fs_stat, vim.api.nvim_buf_get_name(buf))
      if ok and stats and stats.size > max_filesize then
        return true
      end
    end,
    -- Setting this to true will run `:h syntax` and tree-sitter at the same time.
    -- Set this to `true` if you depend on 'syntax' being enabled (like for indentation).
    -- Using this option may slow down your editor, and you may see some duplicate highlights.
    -- Instead of true it can also be a list of languages
    additional_vim_regex_highlighting = false,
  },
  indent = {
    enable = true,
  },
  context_commentstring = {
    enable = true,
    enable_autocmd = false,
  },
  rainbow = {
    enable = true,
    extended_mode = false,
    max_file_lines = 5000,
  },
}

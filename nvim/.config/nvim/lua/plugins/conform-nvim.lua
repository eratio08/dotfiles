local supported = {
  'astro',
  'css',
  'graphql',
  -- "html",
  'javascript',
  'javascriptreact',
  'json',
  'jsonc',
  -- "markdown",
  'svelte',
  'typescript',
  'typescriptreact',
  'vue',
  -- "yaml",
}

return {
  'stevearc/conform.nvim',
  event = { 'InsertEnter', 'BufWritePre' },
  cmd = { 'ConformInfo' },
  dependencies = {
    'folke/which-key.nvim',
  },
  opts = function (_, opts)
    opts.formatters_by_ft = opts.formatters_by_ft or {}
    -- dynamically extend all supported with biome
    for _, ft in ipairs(supported) do
      opts.formatters_by_ft[ft] = opts.formatters_by_ft[ft] or {}
      table.insert(opts.formatters_by_ft[ft], 'biome')
    end
    opts.formatters = opts.formatters or {}
    opts.formatters.biome = {
      require_cwd = true,
    }
  end,
  config = function (_, opts)
    opts = vim.tbl_deep_extend('force', opts, {
      notify_on_error = true,
      format_on_save = function (bufnr)
        -- Disable "format_on_save lsp_fallback" for languages that don't
        -- have a well standardized coding style.
        local disable_filetypes = {}
        local lsp_format_opt
        if disable_filetypes[vim.bo[bufnr].filetype] then
          lsp_format_opt = 'never'
        else
          lsp_format_opt = 'fallback'
        end
        return {
          timeout_ms = 500,
          lsp_format = lsp_format_opt,
        }
      end,
      formatters_by_ft = {
        python = { 'isort', 'black' },
        terraform = { 'tofu' },
        go = { 'goimports', 'gofumpt' },
      },
      formatters = {
        tofu = {
          command = 'tofu',
          args = { 'fmt', '-no-color', '-' }
        },
        biome = {
          require_cwd = true,
        },
      },
    })
    require('conform').setup(opts)

    require('which-key').add({ {
      '<leader>ll',
      ':Format<CR>',
      mode = { 'n', 'v' },
      desc = 'Format Buffer'
    } })

    vim.api.nvim_create_user_command('Format', function (args)
      local range = nil
      if args.count ~= -1 then
        local end_line = vim.api.nvim_buf_get_lines(0, args.line2 - 1, args.line2, true)[1]
        range = {
          start = { args.line1, 0 },
          ['end'] = { args.line2, end_line:len() },
        }
      end
      require('conform').format({ async = true, lsp_fallback = true, range = range })
    end, { range = true })
  end,
}

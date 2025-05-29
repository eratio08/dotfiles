return {
  'stevearc/conform.nvim',
  event = { 'InsertEnter', 'BufWritePre' },
  cmd = { 'ConformInfo' },
  dependencies = {
    'folke/which-key.nvim',
  },
  opts = function (_, opts)
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
      -- 'sql',
    }

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
      format_on_save = function ()
        return {
          timeout_ms = 60000,
          lsp_format = 'fallback',
        }
      end,
      formatters_by_ft = {
        terraform = { 'tofu' },
        go = { 'goimports', 'gofumpt' },
        sql = { 'sqlfmt', 'sqruff', 'sqlfluff', stop_after_first = true }
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

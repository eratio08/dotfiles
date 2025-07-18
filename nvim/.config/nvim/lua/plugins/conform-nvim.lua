return {
  'stevearc/conform.nvim',
  event = { 'InsertEnter', 'BufWritePre' },
  cmd = { 'ConformInfo' },
  dependencies = {
    'folke/which-key.nvim',
  },
  config = function (_, opts)
    opts = {
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
    }

    for _, ft in ipairs({ 'astro', 'css', 'graphql', 'javascript', 'javascriptreact', 'json', 'jsonc', 'svelte',
      'typescript', 'typescript.tsx', 'typescriptreact', 'vue' }) do
      opts.formatters_by_ft[ft] = opts.formatters_by_ft[ft] or {}
      table.insert(opts.formatters_by_ft[ft], 'biome')
      table.insert(opts.formatters_by_ft[ft], 'biome-organize-imports')
      -- table.insert(opts.formatters_by_ft[ft], 'biome-check')
    end
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

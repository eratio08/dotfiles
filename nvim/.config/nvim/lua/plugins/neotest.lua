return {
  'nvim-neotest/neotest',
  dependencies = {
    'nvim-neotest/nvim-nio',
    'nvim-lua/plenary.nvim',
    'antoinemadec/FixCursorHold.nvim',
    'nvim-treesitter/nvim-treesitter',
    -- adapters
    'marilari88/neotest-vitest',
    { 'fredrikaverpil/neotest-golang', version = '*' },
  },
  keys = {
    { '<leader>t', '', desc = '+test' },
    { '<leader>tt', function () require('neotest').run.run(vim.fn.expand('%')) end, desc = 'Run File (Neotest)' },
    { '<leader>tT', function () require('neotest').run.run(vim.uv.cwd()) end, desc = 'Run All Test Files (Neotest)' },
    { '<leader>tr', function () require('neotest').run.run() end, desc = 'Run Nearest (Neotest)' },
    { '<leader>tl', function () require('neotest').run.run_last() end, desc = 'Run Last (Neotest)' },
    { '<leader>ts', function () require('neotest').summary.toggle() end, desc = 'Toggle Summary (Neotest)' },
    { '<leader>to', function () require('neotest').output.open({ enter = true, auto_close = true }) end, desc = 'Show Output (Neotest)' },
    { '<leader>tO', function () require('neotest').output_panel.toggle() end, desc = 'Toggle Output Panel (Neotest)' },
    { '<leader>tS', function () require('neotest').run.stop() end, desc = 'Stop (Neotest)' },
    { '<leader>tw', function () require('neotest').watch.toggle(vim.fn.expand('%')) end, desc = 'Toggle Watch (Neotest)' },
  },
  opts = {
    adapters = {
      ['neotest-vitest'] = {},
      ['neotest-golang'] = {}
    },
    status = { virtual_text = true },
    output = { open_on_run = true },
    quickfix = {
      open = function ()
        vim.cmd('copen')
      end,
    },
  },
  config = function (_, opts)
    local neotest_ns = vim.api.nvim_create_namespace('neotest')
    vim.diagnostic.config({
      virtual_text = {
        format = function (diagnostic)
          -- Replace newline and tab characters with space for more compact diagnostics
          local message = diagnostic.message:gsub('\n', ' '):gsub('\t', ' '):gsub('%s+', ' '):gsub('^%s+', '')
          return message
        end,
      },
    }, neotest_ns)

    require('neotest').setup(opts)
  end,

}

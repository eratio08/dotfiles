return {
  'mfussenegger/nvim-dap',
  keys = { '<leader>b', '<leader>B', '<F8>', '<leader>dd' },
  dependencies = {
    'rcarriga/nvim-dap-ui',
    'williamboman/mason.nvim',
    'jay-babu/mason-nvim-dap.nvim',
    'folke/which-key.nvim',
  },
  config = function ()
    require('mason-nvim-dap').setup {
      automatic_setup = true,
      handlers = {},
      ensure_installed = {},
    }

    -- DAP & DAP UI --
    local dap = require('dap')
    local dapui = require('dapui')
    dapui.setup {
      icons = { expanded = '▾', collapsed = '▸', current_frame = '*' },
      controls = {
        icons = {
          pause = '⏸',
          play = '▶',
          step_into = '⏎',
          step_over = '⏭',
          step_out = '⏮',
          step_back = 'b',
          run_last = '▶▶',
          terminate = '⏹',
          disconnect = '⏏',
        },
      },
    }
    dap.listeners.after.event_initialized['dapui_config'] = dapui.open
    dap.listeners.before.event_terminated['dapui_config'] = dapui.close
    dap.listeners.before.event_exited['dapui_config'] = dapui.close

    -- Mappings --
    require('which-key').register({
      dd = { dapui.toggle, 'Debug: Toggle UI' },
      ['<F8>'] = { dap.continue, 'Debug: Start/Continue' },
      ['<F9>'] = { dap.step_over, 'Debug: Step Over' },
      ['<F21>'] = { dap.step_into, 'Debug: Step Into' },
      ['<F7>'] = { dap.step_out, 'Debug: Step Out' },
      ['<S-F8>'] = { dapui.toggle, 'Debug: See last session result.' },
      ['<leader>b'] = { dap.toggle_breakpoint, 'Debug: Toggle Breakpoint' },
      ['<leader>B'] = { function () dap.set_breakpoint(vim.fn.input 'Breakpoint condition: ') end, 'Debug: Set Breakpoint' },
    })

    -- DAP Configurations --
    dap.adapters.ocamlearlybird = {
      type = 'executable',
      command = 'ocamlearlybird',
      args = { 'debug' }
    }
    dap.configurations.ocaml = {
      {
        name = 'OCaml Debug test.bc',
        type = 'ocamlearlybird',
        request = 'launch',
        program = '${workspaceFolder}/_build/default/test/test.bc',
      },
      {
        name = 'OCaml Debug main.bc',
        type = 'ocamlearlybird',
        request = 'launch',
        program = '${workspaceFolder}/_build/default/bin/main.bc',
      },
      {
        name = 'OCaml Debug debug.bc',
        type = 'ocamlearlybird',
        request = 'launch',
        program = '${workspaceFolder}/_build/default/debug/debug.bc',
      },
    }
  end,
}

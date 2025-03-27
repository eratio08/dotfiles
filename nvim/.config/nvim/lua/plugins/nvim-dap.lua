return {
  enabled = false,
  'mfussenegger/nvim-dap',
  keys = {
    { '<leader>b', desc = 'Toggle Debugger Breakpoint' },
    { '<leader>B', desc = 'Set Debugger Breakpoint' },
    { '<F8>', desc = 'Start/Continue Debuging' },
    { '<leader>dd', desc = 'Toggle Debugger UI' },
  },
  dependencies = {
    'rcarriga/nvim-dap-ui',
    'nvim-neotest/nvim-nio',
    'williamboman/mason.nvim',
    'jay-babu/mason-nvim-dap.nvim',
    'folke/which-key.nvim',
  },
  config = function ()
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
    require('which-key').add({
      { '<leader>dd', dapui.toggle, desc = 'Debug: Toggle UI' },
      { '<F8>', dap.continue, desc = 'Debug: Start/Continue' },
      { '<F9>', dap.step_over, desc = 'Debug: Step Over' },
      { '<F21>', dap.step_into, desc = 'Debug: Step Into' },
      { '<F7>', dap.step_out, desc = 'Debug: Step Out' },
      { '<S-F8>', dapui.toggle, desc = 'Debug: See last session result.' },
      { '<leader>b', dap.toggle_breakpoint, desc = 'Debug: Toggle Breakpoint' },
      { '<leader>B', function () dap.set_breakpoint(vim.fn.input 'Breakpoint condition: ') end },
    })

    -- DAP Configurations --
    require('mason-nvim-dap').setup {
      ensure_installed = {},
      automatic_installation = true,
      handlers = {},
    }

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
    dap.adapters['pwa-node'] = {
      type = 'server',
      host = 'localhost',
      port = '${port}',
      executable = {
        command = 'node',
        args = { 'js-debug/src/dapDebugServer.js', '${port}' },
      }
    }
    dap.configurations.javascript = {
      {
        type = 'pwa-node',
        request = 'launch',
        name = 'Launch file',
        program = '${file}',
        cwd = '${workspaceFolder}',
      },
    }
    dap.configurations.typescript = {
      {
        type = 'pwa-node',
        request = 'launch',
        name = 'Launch file',
        program = '${file}',
        cwd = '${workspaceFolder}',
      },
      {
        type = 'pwa-node',
        request = 'launch',
        name = 'Debug Current Test File',
        autoAttachChildProcesses = true,
        skipFiles = { '<node_internals>/**', '**/node_modules/**' },
        program = '${workspaceRoot}/node_modules/vitest/vitest.mjs',
        args = { 'run', '${relativeFile}' },
        smartStep = true,
        console = 'integratedTerminal',
        -- port = 9229
      },
    }
  end,
}

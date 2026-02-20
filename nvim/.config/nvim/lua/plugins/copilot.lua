return {
  enabled = true,
  'zbirenbaum/copilot.lua',
  dependencies = {
    -- {
    --   'copilotlsp-nvim/copilot-lsp',
    --   init = function ()
    --     vim.g.copilot_nes_debounce = 500
    --   end,
    -- },
  },
  cmd = 'Copilot',
  event = 'InsertEnter',
  keys = {
    { '<leader>ct', function () require('copilot.suggestion').toggle_auto_trigger() end, desc = 'Copilot Toggle Auto Suggestions' }
  },
  config = function ()
    require('copilot').setup({
      panel = {
        enabled = false,
        keymap = {
          open = '<M-o>',
        },
      },
      suggestion = {
        auto_trigger = true,
        keymap = {
          accept = '<M-CR>',
          next = '<M-]>',
          prev = '<M-[>',
        },
      },
      nes = {
        enabled = false,
        keymap = {
          accept_and_goto = '<leader>p',
          accept = false,
          dismiss = '<Esc>',
        },
      },
      -- filetypes = {
      --   markdown = true,
      --   help = true,
      --   ocaml = false,
      --   roc = false,
      --   elixir = false,
      -- },
    })

    -- Hide completion menu on Copilot suggestions
    vim.api.nvim_create_autocmd('User', {
      pattern = 'BlinkCmpMenuOpen',
      callback = function ()
        vim.b.copilot_suggestion_hidden = true
      end,
    })
    vim.api.nvim_create_autocmd('User', {
      pattern = 'BlinkCmpMenuClose',
      callback = function ()
        vim.b.copilot_suggestion_hidden = false
      end,
    })
  end
}

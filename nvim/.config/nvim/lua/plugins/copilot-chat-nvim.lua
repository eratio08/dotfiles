return {
  enabled = true,
  'CopilotC-Nvim/CopilotChat.nvim',
  dependencies = {
    -- native dependencies: tiktoke, ripgrep & lynx
    'zbirenbaum/copilot.lua',
    { 'nvim-lua/plenary.nvim', branch = 'master' },
  },
  branch = 'main',
  build = 'make tiktoken',
  keys = {
    -- Take from LazyNvim
    { '<c-s>', '<CR>', ft = 'copilot-chat', desc = 'Submit Prompt', remap = true },
    { '<leader>a', '', desc = '+ai', mode = { 'n', 'v' } },
    {
      '<leader>aa',
      function ()
        return require('CopilotChat').toggle()
      end,
      desc = 'Toggle (CopilotChat)',
      mode = { 'n', 'v' },
    },
    {
      '<leader>ax',
      function ()
        return require('CopilotChat').reset()
      end,
      desc = 'Clear (CopilotChat)',
      mode = { 'n', 'v' },
    },
    {
      '<leader>aq',
      function ()
        vim.ui.input({
          prompt = 'Quick Chat: ',
        }, function (input)
          if input ~= '' then
            require('CopilotChat').ask(input)
          end
        end)
      end,
      desc = 'Quick Chat (CopilotChat)',
      mode = { 'n', 'v' },
    },
    {
      '<leader>ap',
      function ()
        require('CopilotChat').select_prompt()
      end,
      desc = 'Prompt Actions (CopilotChat)',
      mode = { 'n', 'v' },
    },
    {
      '<leader>am',
      function ()
        require('CopilotChat').select_model()
      end,
      desc = 'Models (CopilotChat)',
      mode = { 'n', 'v' },
    },
  },
  ---@type CopilotChat.config
  opts = {
    auto_insert_mode = false,
    question_header = '  Me ',
    answer_header = '  Copilot ',
    window = {
      layout = 'vertical',
      width = 0.45,
    },
    model = 'claude-sonnet-4',
    agent = 'copilot',
    cotext = 'viewport',
    highlight_selection = false,
    mappings = {
      reset = {
        normal = '<C-x>',
        insert = '<C-x>',
      },
      show_diff = {
        full_diff = true
      },
    },
    -- selection = function (source)
    --   local select = require('CopilotChat.select')
    --   return select.visual(source)
    -- end,
    contexts = {
      viewport = {
        description = 'Visible Buffers',
        input = function () end,
        resolve = function ()
          local utils = require('CopilotChat.utils')
          local context = require('CopilotChat.context')
          local is_visible = function (b) return #vim.fn.win_findbuf(b) > 0 end
          local is_not_copilot_chat = function (b)
            local ft = vim.bo[b].filetype
            return ft ~= 'copilot-chat'
          end
          local visible_buffers = function ()
            local visible = vim.tbl_filter(is_visible, vim.api.nvim_list_bufs())
            return vim.tbl_filter(is_not_copilot_chat, visible)
          end
          local get_visible_buffers_content = function ()
            return vim.tbl_map(context.get_buffer, visible_buffers())
          end

          utils.schedule_main()
          return get_visible_buffers_content()
        end,
      }
    }
  },
  config = function (_, opts)
    local chat = require('CopilotChat')
    vim.api.nvim_create_autocmd('BufEnter', {
      pattern = 'copilot-chat',
      callback = function ()
        vim.opt_local.relativenumber = false
        vim.opt_local.number = false
      end,
    })

    chat.setup(opts)
  end,
}

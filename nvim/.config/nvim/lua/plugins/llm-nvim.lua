return {
  'huggingface/llm.nvim',
  enabled = false,                -- could not get it to work for now
  lazy = false,
  build = ':MasonInstall llm-ls', -- ensure llm-ls is isntalled
  config = function ()
    require('llm').setup({
      model = 'llama2:13b',
      --
      backend = 'ollama',
      url = 'http://localhost:11434/api/generate',
      request_body = {
        options = {
          temperature = 0.2,
          top_p = 0.95,
        }
      },
      --

      -- backend = 'openai', -- using openai api of ollama
      -- url = 'http://localhost:11434/v1/chat/completions',
      -- request_body = {
      --   model = 'codellama:7-code',
      -- },

      -- tokens_to_clear = { '<EOT>' },
      -- fim = {
      --   enabled = true,
      --   prefix = '<PRE> ',
      --   middle = ' <MID>',
      --   suffix = ' <SUF>',
      -- },
      -- context_window = 4096,

      -- tokenizer = {
      --   repository = 'codellama/CodeLlama-7b-hf',
      -- },
      -- accept_keymap = '<c-g>',
      -- dismiss_keymap = '<c-x>',
      lsp = {
        -- bc llm-ls is managed with Mason
        bin_path = vim.api.nvim_call_function('stdpath', { 'data' }) .. '/mason/bin/llm-ls',
      },
    })
  end
}

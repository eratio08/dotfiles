return {
  'huggingface/llm.nvim',
  -- does not work well on m1 macbook
  enabled = false,
  event = 'VeryLazy',
  config = function ()
    require('llm').setup({
      backend = 'ollama',
      url = 'http://localhost:11434/api/generate',
      model = 'codestral:latest',
      fim = {
        enabled = true,
        model = 'model',
        prompt = 'prompt',
        suffix = 'suffix',
      },
      accept_keymap = '<c-j>',
      -- dismiss_keymap = '<c-x>',
      lsp = {
        -- llm-ls is managed with Mason
        bin_path = vim.api.nvim_call_function('stdpath', { 'data' }) .. '/mason/bin/llm-ls',
      },
    })
  end
}

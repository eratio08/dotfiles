return {
  'huggingface/llm.nvim',
  -- does not work well on m1 macbook
  enabled = false,
  -- build = ':MasonInstall llm-ls',
  config = function ()
    require('llm').setup({
      backend = 'ollama',
      url = 'http://localhost:11434/api/generate',
      model = 'codellama:7b',
      request_body = {},
      tokens_to_clear = { '<EOT>' },
      fim = {
        enabled = true,
        prefix = '<PRE> ',
        middle = ' <MID>',
        suffix = ' <SUF>',
      },
      context_window = 4096,
      tokenizer = {
        repository = 'codellama/CodeLlama-7b-hf',
      },
      accept_keymap = '<c-g>',
      dismiss_keymap = '<c-x>',
      lsp = {
        -- bc llm-ls is managed with Mason
        bin_path = vim.api.nvim_call_function('stdpath', { 'data' }) .. '/mason/bin/llm-ls',
      },
    })
  end
}

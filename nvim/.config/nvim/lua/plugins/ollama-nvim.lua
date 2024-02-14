return {
  'nomnivore/ollama.nvim',
  dependencies = { 'nvim-lua/plenary.nvim' },
  cmd = { 'Ollama', 'OllamaModel', 'OllamaServe', 'OllamaServeStop' },
  keys = {
    -- Note that the <c-u> is important for selections to work properly.
    {
      '<leader>oo',
      ":<c-u>lua require('ollama').prompt()<cr>",
      desc = 'ollama prompt',
      mode = { 'n', 'v' },
    },
    {
      '<leader>og',
      ":<c-u>lua require('ollama').prompt('Generate_Code')<cr>",
      desc = 'ollama Generate Code',
      mode = { 'n', 'v' },
    },
  },

  ---@type Ollama.Config
  opts = {
    prompts = {
      -- todo add general prompt
      ['Without Context'] = {
        prompt = '',
        input = '> '
      },
    }
  }
}

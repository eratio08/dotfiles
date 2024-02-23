return {
  'dustinblackman/oatmeal.nvim',
  cmd = { 'Oatmeal' },
  keys = {
    { '<leader>om', mode = { 'n', 'v' }, desc = 'Start Oatmeal session' },
  },
  opts = {
    backend = 'ollama',
    model = 'codellama:13b',
  },
}

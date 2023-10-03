return {
  'dense-analysis/neural',
  cmd = { 'Neural', 'NeuralExplain' },
  dependencies = { { 'ElPiloto/significant.nvim' } },
  config = function ()
    require('neural').setup({
      selected = 'chatgpt',
      ui = {
        animated_sign_enabled = true,
        prompt_icon = '>',
      },
      pre_process = {
        enabled = true,
      },
      source = {
        openai = {
          api_key = vim.env.OPENAI_API_KEY,
        },
        chatgpt = {
          api_key = vim.env.OPENAI_API_KEY,
        },
      },
    })
  end
}

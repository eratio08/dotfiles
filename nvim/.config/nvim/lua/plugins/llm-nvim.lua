return {
  'huggingface/llm.nvim',
  cmd = { 'LLMToggleAutoSuggest', 'LLMSuggestion' },
  config = function ()
    -- ':MasonInstall llm-ls'
    require('llm').setup({
      model = 'codellama:13b',
      url = 'http://localhost:11434/api/generate',
      request_body = {
        options = {
          temperature = 0.2,
          top_p = 0.95,
        }
      }
    })
  end
}

return {
  'CopilotC-Nvim/CopilotChat.nvim',
  dependencies = {
    { 'zbirenbaum/copilot.lua' },
    { 'nvim-lua/plenary.nvim' },
  },
  branch = 'main',
  enabled = true,
  cmd = { 'CopilotChatOpen', 'CopilotChat' },
  build = 'make tiktoken',
  opts = {
    -- :CopilotChatPrompts - for selecting prompts
    -- :CopilotChatModels - for selecting models
    -- :CopilotChatAgents - for selecting agents
    -- #<context>:<input> - for selecting context input
    -- :CopilotChat <input>? 	Open chat with optional input
    -- :CopilotChatOpen 	Open chat window
    -- :CopilotChatClose 	Close chat window
    -- :CopilotChatToggle 	Toggle chat window
    -- :CopilotChatStop 	Stop current output
    -- :CopilotChatReset 	Reset chat window
    -- :CopilotChatSave <name>? 	Save chat history
    -- :CopilotChatLoad <name>? 	Load chat history
    -- :CopilotChatPrompts 	View/select prompt templates
    -- :CopilotChatModels 	View/select available models
    -- :CopilotChatAgents 	View/select available agents
    -- :CopilotChat<PromptName> 	Use specific prompt template
  }
}

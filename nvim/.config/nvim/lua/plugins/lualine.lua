return {
  'nvim-lualine/lualine.nvim',
  lazy = false,
  dependencies = { 'kyazdani42/nvim-web-devicons' },
  config = function ()
    local lualine = require('lualine')

    -- Define a function to check the status and return the corresponding icon
    local function ollama_status()
      local ok, ollama = pcall(require, 'ollama')
      if not ok then
        return '❌'
      end

      local status = require('ollama').status()

      if status == 'IDLE' then
        return ''
      elseif status == 'WORKING' then
        return '🦙'
      end
    end

    lualine.setup({
      options = {
        icons_enabled = true,
        theme = 'rose-pine',
        component_separators = { left = '', right = '' },
        section_separators = { left = '', right = '' },
        disabled_filetypes = {},
        always_divide_middle = true,
      },
      sections = {
        lualine_a = { 'mode' },
        lualine_b = { 'branch', 'diff', { 'diagnostics', sources = { 'nvim_diagnostic' } } },
        lualine_c = { { 'filename', path = 1 } },
        lualine_x = { ollama_status, 'encoding', 'fileformat', 'filetype' },
        lualine_y = { 'progress' },
        lualine_z = { 'location' },
      },
      inactive_sections = {
        lualine_a = {},
        lualine_b = {},
        lualine_c = { 'filename' },
        lualine_x = { 'location' },
        lualine_y = {},
        lualine_z = {},
      },
      tabline = {},
      extensions = {},
    })
  end
}

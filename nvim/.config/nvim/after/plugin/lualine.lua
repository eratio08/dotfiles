local lualine = require('lualine')

local colors = {
  base = '#191724',
  surface = '#1f1d2e',
  overlay = '#26233a',
  muted = '#6e6a86',
  subtle = '#908caa',
  text = '#e0def4',
  love = '#eb6f92',
  gold = '#f6c177',
  rose = '#ebbcba',
  pine = '#31748f',
  foam = '#9ccfd8',
  iris = '#c4a7e7',
  hl_low = '#21202e',
  hl_med = '#403d52',
  hl_high = '#524f67',
}

local rose_pine = {
  normal = {
    a = { bg = colors.iris, fg = colors.base, gui = 'bold' },
    b = { bg = colors.base, fg = colors.rose },
    c = { bg = colors.base, fg = colors.rose }
  },
  insert = {
    a = { bg = colors.foam, fg = colors.base, gui = 'bold' },
    b = { bg = colors.base, fg = colors.rose },
    c = { bg = colors.base, fg = colors.rose }
  },
  visual = {
    a = { bg = colors.gold, fg = colors.base, gui = 'bold' },
    b = { bg = colors.base, fg = colors.rose },
    c = { bg = colors.base, fg = colors.rose }
  },
  replace = {
    a = { bg = colors.red, fg = colors.base, gui = 'bold' },
    b = { bg = colors.base, fg = colors.rose },
    c = { bg = colors.base, fg = colors.rose }
  },
  command = {
    a = { bg = colors.rose, fg = colors.base, gui = 'bold' },
    b = { bg = colors.base, fg = colors.rose },
    c = { bg = colors.base, fg = colors.rose }
  },
  inactive = {
    a = { bg = colors.text, fg = colors.base, gui = 'bold' },
    b = { bg = colors.base, fg = colors.rose },
    c = { bg = colors.base, fg = colors.rose }
  }
}

lualine.setup({
  options = {
    icons_enabled = true,
    theme = rose_pine,
    component_separators = { left = '', right = '' },
    section_separators = { left = '', right = '' },
    disabled_filetypes = {},
    always_divide_middle = true,
  },
  sections = {
    lualine_a = { 'mode' },
    lualine_b = { 'branch', 'diff', { 'diagnostics', sources = { 'nvim_diagnostic' } } },
    lualine_c = { { 'filename', path = 1 } },
    lualine_x = { 'encoding', 'fileformat', 'filetype' },
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

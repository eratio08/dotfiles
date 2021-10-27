-- kyazdani42/nvim-web-devicons

if vim.g.plugs['nvim-web-devicons'] then

local devicons = require('nvim-web-devicons')

devicons.setup {
  -- globally enable default icons (default to false)
  default = true;
}

end

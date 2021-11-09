-- kyazdani42/nvim-web-devicons
local requireIfPresent = require('eratio.utils').requireIfPresent
local web_devicons = requireIfPresent('nvim-web-devicons')

if not web_devicons then
  return
end

web_devicons.setup({
  default = true,
})

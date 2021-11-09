-- mfussenegger/nvim-dap

local requireIfPresent = require('eratio.utils').requireIfPresent

local dap = requireIfPresent('dap')

if not dap then
  return
end

-- nothing yet

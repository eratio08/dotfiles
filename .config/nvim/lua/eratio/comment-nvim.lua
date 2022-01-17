-- numToStr/Comment.nvim
local requireIfPresent = require('eratio.utils').requireIfPresent
local comment = requireIfPresent('Comment')

if not comment then
  return
end

comment.setup()

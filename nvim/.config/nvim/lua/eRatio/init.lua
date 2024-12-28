require('eRatio.remap')
require('eRatio.settings')
require('eRatio.lazy')
require('eRatio.cmd')

if vim.fn.getenv('TERM_PROGRAM') == 'ghostty' then
  vim.opt.title = true
  vim.opt.titlestring = "%{fnamemodify(getcwd(), ':t')}"
end

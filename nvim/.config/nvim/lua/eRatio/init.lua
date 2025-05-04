require('eRatio.remap')
require('eRatio.settings')
require('eRatio.helpers')
require('eRatio.lazy')
require('eRatio.cmd')
require('eRatio.rds-auth')

if vim.fn.getenv('TERM_PROGRAM') == 'ghostty' then
  vim.opt.title = true
  vim.opt.titlestring = "%{fnamemodify(getcwd(), ':t')}"
end

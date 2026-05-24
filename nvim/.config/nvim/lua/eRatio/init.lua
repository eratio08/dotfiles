require('eRatio.remap')
require('eRatio.settings')
require('eRatio.helpers')
require('eRatio.lazy')
require('eRatio.diag')
require('eRatio.cmd')
require('eRatio.rds-auth')

if vim.fn.getenv('TERM_PROGRAM') == 'ghostty' then
  vim.opt.title = true
  vim.opt.titlestring = "%{fnamemodify(getcwd(), ':t')}"
end


vim.api.nvim_create_user_command(
  'MyLspInfo',
  function ()
    vim.print(vim.iter(vim.lsp.get_clients({ bufnr = 0 })):map(function (c) return c.name end):totable())
  end,
  { desc = 'Print the names of the LSP clients attached to the current buffer' }
)

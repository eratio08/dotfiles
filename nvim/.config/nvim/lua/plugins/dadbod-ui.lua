return {
  'kristijanhusak/vim-dadbod-ui',
  dependencies = {
    { 'tpope/vim-dadbod', lazy = true },
    { 'kristijanhusak/vim-dadbod-completion', ft = { 'sql', 'mysql', 'plsql' }, lazy = true },
  },
  cmd = { 'DBUI', 'DBUIToggle', 'DBUIAddConnection', 'DBUIFindBuffer' },
  keys = { { '<leader>db', ':DBUIToggle<CR>', desc = 'DeBee Toggle' } },
  init = function ()
    vim.g.db_ui_use_nerd_fonts = 1
  end,
  config = function ()
    local data_path = vim.fn.stdpath('data')
    vim.g.db_ui_save_location = data_path .. '/dadbod_ui'
    vim.g.db_ui_tmp_query_location = data_path .. '/dadbod_ui/tmp'

    vim.g.db_ui_auto_execute_table_helpers = 1
    vim.g.db_ui_show_database_icon = true
    vim.g.db_ui_use_nerd_fonts = true
    vim.g.db_ui_use_nvim_notify = true
    vim.g.db_ui_win_position = 'right'

    vim.g.dbs = {
      { name = 'dbt-source', url = 'postgres://finion:changeme@127.0.0.1:5432/finion?sslmode=disable' },
      { name = 'dbt-target', url = 'postgres://finion:changeme@127.0.0.1:5433/finion?sslmode=disable' },
    }
  end
}

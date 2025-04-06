return {
  enabled = false,
  'kndndrj/nvim-dbee',
  dependencies = {
    'MunifTanjim/nui.nvim',
  },
  build = function ()
    require('dbee').install()
  end,
  keys = {
    {
      '<leader>db',
      function () require('dbee').toggle() end,
      desc = 'DeBee Toggle',
    },
  },
  config = true,
  ---@module 'dbee'
  ---@return Config
  opts = function ()
    return {
      sources = {
        require('dbee.sources').MemorySource:new({
          {
            id = 'dbt-source',
            name = 'DBT Source',
            type = 'postgres',
            url = 'postgres://finion:changeme@127.0.0.1:5432?sslmode=disable',
          },
          {
            id = 'dbt-target',
            name = 'DBT Target',
            type = 'postgres',
            url = 'postgres://finion:changeme@127.0.0.1:5433?sslmode=disable',
          },
        }),
        require('dbee.sources').EnvSource:new('DBEE_CONNECTIONS'),
        require('dbee.sources').FileSource:new(vim.fn.stdpath('cache') .. '/dbee/persistence.json'),
      },
    }
  end,
}

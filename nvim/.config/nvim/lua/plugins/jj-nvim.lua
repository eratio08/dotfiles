return {
  'nicolasgb/jj.nvim',
  cmd = 'J',
  version = '*',
  dependencies = {
    'folke/snacks.nvim',
    -- "esmuellert/codediff.nvim",
    'sindrets/diffview.nvim',
  },
  config = function ()
    require('jj').setup({
      diff = {
        backend = 'diffview'
      },
      cmd = {
        keymaps = {
          floating = {
            hide = {},
          },
        },
      },
    })
  end,
}

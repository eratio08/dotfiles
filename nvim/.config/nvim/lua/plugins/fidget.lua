return {
  'j-hui/fidget.nvim',
  lazy = false,
  tag = 'legacy',
  config = function ()
    local fidget = require('fidget')

    fidget.setup({
      text = {
        spinner = 'moon',
        done = '✔',
        commended = '🤖',
        completed = '✔',
      },
      align = {
        bottom = false,
        right = true,
      },
      window = {
        relative = 'editor',
        blend = '90'
      },
    })
  end
}

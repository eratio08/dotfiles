return {
  'j-hui/fidget.nvim',
  event = 'BufEnter',
  tag = 'legacy',
  config = function ()
    require('fidget').setup({
      text = {
        spinner = 'dots_negative',
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

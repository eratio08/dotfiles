return {
  enabled = true,
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
        blend = 0,
      },
      fmt = {
        stack_upwards = false,
      },
    })

    local p = require('rose-pine.palette')
    vim.api.nvim_set_hl(0, 'FidgetTitle', { bg = 'NONE', ctermbg = 'NONE', fg = p.foam })
    vim.api.nvim_set_hl(0, 'FidgetTask', { bg = 'NONE', ctermbg = 'NONE', fg = p.pine })
  end
}

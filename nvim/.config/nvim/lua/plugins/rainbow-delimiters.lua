return {
  'HiPhish/rainbow-delimiters.nvim',
  event = 'VeryLazy',
  config = function ()
    local rainbow = require('rainbow-delimiters')
    require('rainbow-delimiters.setup')(
      {
        strategy = {
          [''] = rainbow.strategy['global'],
          commonlisp = rainbow.strategy['local'],
          go = function (bufnr)
            local line_count = vim.api.nvim_buf_line_count(bufnr)
            if line_count > 5000 then
              return nil
            elseif line_count > 1000 then
              return rainbow.strategy['global']
            end
            return rainbow.strategy['local']
          end
        },
        query = {
          [''] = 'rainbow-delimiters',
          latex = 'rainbow-blocks',
        },
        highlight = {
          'RainbowDelimiterRed',
          'RainbowDelimiterYellow',
          'RainbowDelimiterBlue',
          'RainbowDelimiterOrange',
          'RainbowDelimiterGreen',
          'RainbowDelimiterViolet',
          'RainbowDelimiterCyan',
        },
      }
    )
  end
}

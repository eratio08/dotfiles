vim.g.if_present('which-key', function (wk)
  wk.add({
    { '<space><space>x', '<cmd>source %<CR>', desc = 'Source current file', mode = 'n' },
    { '<space>x', ':%lua<CR>', desc = 'Execute current file in lua', mode = 'n' },
    { '<space>x', ':lua<CR>', desc = 'Execute current line in lua', mode = 'v' },
  })
end)

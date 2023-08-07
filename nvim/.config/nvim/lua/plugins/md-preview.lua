return {
  'iamcco/markdown-preview.nvim',
  lazy = true,
  build = function ()
    vim.fn['mkdp#util#install']()
  end,
}

-- itchyny/lightline.vim

local g = vim.g
if not g.plugs['lightline.vim'] then
  return
end

g.lightline = {
  colorscheme = 'wombat',
  component_function = {
    gitbranch = 'gitbranch#name',
  },
  active = {
    left = {
      { 'mode' },
      { 'gitbranch' },
      { 'filename' },
      { 'filetype' },
    },
    right = {
      { 'readonly', 'modified' },
      { 'fileencoding' },
      { 'lineinfo' },
      { 'percent' },
    },
  },
}

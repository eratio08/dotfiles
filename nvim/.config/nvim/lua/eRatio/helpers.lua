vim.g.if_present = function (mod, fn)
  local exists, module = pcall(require, mod)
  if exists then
    fn(module)
  end
end

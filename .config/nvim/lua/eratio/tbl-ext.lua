-- helper factions for tables

vim.tbl_foldr = function (fn, b, a)
    local acc = vim.deepcopy(b)

    for _,v in ipairs(a) do
        acc = fn(v, acc)
    end
    return acc
end


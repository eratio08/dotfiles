-- rafamadriz/friendly-snippets

if vim.g.plugs['friendly-snippets'] then

local plugged_dir = vim.fn.stdpath('data') .. '/plugged'

local snippets_paths = function()
    local plugins = { "friendly-snippets" }
    local paths = {}
    local path
    local root_path = plugged_dir
    for _, plug in ipairs(plugins) do
        path = root_path .. plug
        if vim.fn.isdirectory(path) ~= 0 then
            table.insert(paths, path)
        end
    end
    return paths
end

require("luasnip.loaders.from_vscode").lazy_load({
    paths = snippets_paths(),
    include = nil,  -- Load all languages
    exclude = {}
})

end

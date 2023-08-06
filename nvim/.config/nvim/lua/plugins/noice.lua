return {
  'folke/noice.nvim',
  event = 'VeryLazy',
  opts = {},
  dependencies = {
    { 'MunifTanjim/nui.nvim' },
    { 'rcarriga/nvim-notify' },
  },
  config = function ()
    require('noice').setup({
      lsp = {
        progress = {
          view = 'mini',
        },
        override = {
          -- override the default lsp markdown formatter with Noice
          ['vim.lsp.util.convert_input_to_markdown_lines'] = true,
          -- override the lsp markdown formatter with Noice
          ['vim.lsp.util.stylize_markdown'] = true,
          -- override cmp documentation with Noice (needs the other options to work)
          ['cmp.entry.get_documentation'] = true,
        },
      },
      -- you can enable a preset for easier configuration
      presets = {
        bottom_search = true,         -- use a classic bottom cmdline for search
        command_palette = true,       -- position the cmdline and popupmenu together
        long_message_to_split = true, -- long messages will be sent to a split
        inc_rename = false,           -- enables an input dialog for inc-rename.nvim
        lsp_doc_border = true,        -- add a border to hover docs and signature help
      },
    })

    require('notify').setup({
      background_colour = '#000000',
    })
  end
}

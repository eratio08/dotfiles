return {
  'kevinhwang91/nvim-ufo',
  event = 'VeryLazy',
  dependencies = {
    'kevinhwang91/promise-async',
    'nvim-treesitter/nvim-treesitter',
    { -- required to hide fold count number in fold column
      'luukvbaal/statuscol.nvim',
      config = function ()
        local builtin = require('statuscol.builtin')
        require('statuscol').setup({
          relculright = true,
          segments = {
            { text = { builtin.foldfunc }, click = 'v:lua.ScFa' },
            { text = { '%s' }, click = 'v:lua.ScSa' },
            { text = { builtin.lnumfunc, ' ' }, click = 'v:lua.ScLa' },
          },
        })
      end,
    },
  },
  config = function ()
    --- @diagnostic disable: unused-local
    local ufo = require('ufo')
    ufo.setup({
      provider_selector = function (_, ft)
        return function (bufnr)
          -- No fold in neo-tree
          if ft == 'neo-tree' then
            return ''
          end

          -- providers: lsp -> treesitter -> indent
          local function handleFallbackException(err, providerName)
            if type(err) == 'string' and err:match('UfoFallbackException') then
              return ufo.getFolds(providerName, bufnr)
            else
              return require('promise').reject(err)
            end
          end

          return ufo.getFolds('lsp', bufnr):catch(function (err)
            return handleFallbackException(err, 'treesitter')
          end):catch(function (err)
            return handleFallbackException(err, 'indent')
          end)
        end
      end,
      fold_virt_text_handler = function (virtText)
        print(vim.inspect(virtText))
        return virtText
      end,
      preview = {
        win_config = {
          border = { '', '─', '', '', '', '─', '', '' },
          winhighlight = 'Normal:Folded',
          winblend = 0,
        },
        mappings = {
          scrollU = '<C-u>',
          scrollD = '<C-d>',
          jumpTop = '[',
          jumpBot = ']',
        },
      },
    })

    local p = require('rose-pine.palette')
    vim.api.nvim_set_hl(0, 'Folded', { bg = p.highlight_low })

    require('which-key').add({
      { 'zR', ufo.openAllFolds(), group = 'Fold', desc = 'Open all folds' },
      { 'zM', ufo.closeAllFolds(), group = 'Fold', desc = 'Close all folds' },
      { 'zp', ufo.peekFoldedLinesUnderCursor(), group = 'Fold', desc = 'Peek folded lines' },
    })
  end
}

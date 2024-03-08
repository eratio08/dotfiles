return {
  'kevinhwang91/nvim-ufo',
  event = 'BufEnter',
  dependencies = { 'kevinhwang91/promise-async', 'nvim-treesitter/nvim-treesitter' },
  config = function ()
    --- @diagnostic disable: unused-local
    local ufo = require('ufo')

    -- lsp->treesitter->indent
    local function customizeSelector(bufnr)
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

    ufo.setup({
      provider_selector = function (bufnr, filetype, buftype)
        return customizeSelector
      end
    })

    require('which-key').register({
      z = {
        title = 'Fold',
        R = { ufo.openAllFolds, 'Open all' },
        M = { ufo.closeAllFolds, 'Close all' },
      }
    })
  end
}

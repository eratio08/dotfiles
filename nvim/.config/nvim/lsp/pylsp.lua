return {
  settings = {
    pylsp = {
      plugins = {
        pycodestyle = {
          enabled = true,
          ignore = {},
          maxLineLength = 120,
        },
        autopep8 = {
          enabled = true,
        },
        flake8 = {
          enabled = false,
        },
        yapf = {
          enabled = false,
        },
        pyflakes = {
          enabled = false,
        }
      }
    }
  }
}

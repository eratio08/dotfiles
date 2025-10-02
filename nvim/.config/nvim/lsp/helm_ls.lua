return {
  settings = {
    ['helm-ls'] = {
      logLevel = 'info',
      valuesFiles = {
        mainValuesFile = 'values.yaml',
        lintOverlayValuesFile = 'values.lint.yaml',
        additionalValuesFilesGlobPattern = 'values*.yaml'
      },
      helmLint = {
        enabled = true,
        ignoredMessages = {},
      },
      yamlls = {
        enabled = true,
        enabledForFilesGlob = '*.{yaml,yml}',
        diagnosticsLimit = 50,
        showDiagnosticsDirectly = false,
        path = vim.fn.stdpath('data') .. '/mason/bin/yaml-language-server',
        initTimeoutSeconds = 3,
        config = {
          schemas = {
            kubernetes = 'templates/**',
          },
          completion = true,
          hover = true,
        }
      }
    }
  }
}

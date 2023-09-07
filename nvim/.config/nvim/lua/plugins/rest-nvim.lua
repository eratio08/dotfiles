return {
  'rest-nvim/rest.nvim',
  ft = 'http',
  dependencies = { { 'nvim-lua/plenary.nvim' } },
  config = function ()
    vim.api.nvim_create_user_command('RestNvim', function ()
      require('rest-nvim').run()
    end, { desc = 'Run RestNvim' })

    require('rest-nvim').setup({
      result_split_horizontal = false,
      result_split_in_place = false,
      skip_ssl_verification = false,
      encode_url = true,
      highlight = {
        enabled = true,
        timeout = 150,
      },
      result = {
        show_url = true,
        show_curl_command = false,
        show_http_info = true,
        show_headers = true,
        formatters = {
          json = 'jq',
          html = function (body)
            return vim.fn.system({ 'tidy', '-i', '-q', '-' }, body)
          end
        },
      },
      jump_to_request = false,
      env_file = '.env',
      custom_dynamic_variables = {},
      yank_dry_run = true,
    })
  end
}

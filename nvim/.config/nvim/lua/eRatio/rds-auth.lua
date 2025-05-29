local M = {}

local read_file = function (file_path)
  local rds_hosts_cmd = string.format('cat %s', file_path)
  local rds_hosts_json = vim.fn.system(rds_hosts_cmd)
  if vim.v.shell_error ~= 0 then
    vim.notify('Failed to read RDS hosts file', vim.log.levels.ERROR)
    return
  end

  return rds_hosts_json
end

function M.update_rds_auth_token(connection_name)
  local connections_file = vim.fn.expand('~/.local/share/nvim/dadbod_ui/connections.json')
  local rds_hosts_file = vim.fn.expand('~/.local/share/nvim/dadbod_ui/rds-hosts.json')

  local rds_hosts_json = read_file(rds_hosts_file)
  local rds_hosts = vim.fn.json_decode(rds_hosts_json)
  local rds_config = nil
  for _, config in ipairs(rds_hosts) do
    if config.name == connection_name then
      rds_config = config
      break
    end
  end
  if not rds_config then
    vim.notify('RDS configuration not found: ' .. connection_name, vim.log.levels.ERROR)
    return
  end

  local conn_json = read_file(connections_file)
  local connections = vim.fn.json_decode(conn_json)
  local connection = nil
  for _, conn in ipairs(connections) do
    if conn.name == connection_name then
      connection = conn
      break
    end
  end
  if not connection then
    vim.notify('Connection not found: ' .. connection_name, vim.log.levels.ERROR)
    return
  end

  local cmd = string.format(
    'AWS_PROFILE=%s aws rds generate-db-auth-token --hostname %s --port 5432 --region eu-central-1 --username %s',
    rds_config.profile,
    rds_config.host,
    rds_config.username
  )

  local token = vim.fn.system(cmd):gsub('[\n\r]', '')
  if vim.v.shell_error ~= 0 then
    vim.notify('Failed to generate auth token: ' .. token, vim.log.levels.ERROR)
    return
  end

  local encoded_token = vim.fn.system('echo -n "' .. token:gsub('"', '\\"') .. '" | jq -sRr @uri'):gsub('[\n\r]', '')
  local new_url = string.format('postgres://%s:%s@%s:%s/%s?sslmode=require',
    rds_config.username,
    encoded_token,
    rds_config.gateway,
    rds_config.port,
    rds_config.database
  )
  local jq_filter = string.format(
    'map(if .name == \"%s\" then .url = \"%s\" else . end)',
    connection_name,
    new_url
  )
  local update_cmd = string.format(
    "jq '%s' %s > %s.tmp && mv %s.tmp %s",
    jq_filter,
    connections_file,
    connections_file,
    connections_file,
    connections_file
  )
  local result = vim.fn.system(update_cmd)
  if vim.v.shell_error ~= 0 then
    vim.notify('Failed to update connection: ' .. result, vim.log.levels.ERROR)
    return
  end

  vim.notify(string.format('Auth token updated for connection: %s', connection_name), vim.log.levels.INFO)
end

vim.api.nvim_create_user_command(
  'RdsAuth',
  function (opts)
    local args = vim.split(opts.args, ' ')
    if #args ~= 1 then
      vim.notify('Usage: RdsAuth <connection_name>', vim.log.levels.ERROR)
      return
    end
    M.update_rds_auth_token(args[1])
  end,
  { nargs = '+', desc = 'Update RDS auth token for a database connection' }
)

return M

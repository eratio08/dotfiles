local M = {}

local defaults = {
  dark_scheme  = 'rose-pine',
  light_scheme = 'rose-pine',
}

local cfg = vim.deepcopy(defaults)

local function check_macos(cb)
  vim.schedule(function ()
    cb(vim.uv.os_uname().sysname == 'Darwin')
  end)
end

local function log(msg, level)
  if not cfg.notify then return end
  vim.schedule(function ()
    vim.notify('[theme_control] ' .. msg, level or vim.log.levels.INFO)
  end)
end

local function run_system(cmd, args, cb)
  vim.system({ cmd, unpack(args or {}) }, { text = true }, function (res)
    if cb then cb(res) end
  end)
end

local function detect_macos_dark(cb)
  check_macos(function (is_macos)
    if not is_macos then
      cb(nil)
      return
    end
    run_system('osascript', {
      '-e',
      'tell application "System Events" to tell appearance preferences to get dark mode'
    }, function (res)
      local out = (res.stdout or ''):gsub('%s+', '')
      if res.code ~= 0 then
        cb(nil, res)
        return
      end
      cb(out == 'true', res)
    end)
  end)
end

local function apply_neovim_theme(dark)
  vim.schedule(function ()
    vim.o.background = dark and 'dark' or 'light'
  end)
end

local function set_macos_appearance(dark, done)
  check_macos(function (is_macos)
    if is_macos then
      local script = dark
        and 'tell application "System Events" to tell appearance preferences to set dark mode to true'
        or 'tell application "System Events" to tell appearance preferences to set dark mode to false'
      run_system('osascript', { '-e', script }, function (res)
        if res.code ~= 0 then
          log('Failed to change macOS appearance (check Automation permissions for Terminal/Neovim host).',
            vim.log.levels.WARN)
          if done then done(false, res) end
          return
        end
        if done then done(true, res) end
      end)
    end
  end)
end

local function switch(dark)
  set_macos_appearance(dark, function (ok)
    apply_neovim_theme(dark)
    if ok then
      log((dark and 'Dark' or 'Light') .. ' theme applied.')
    else
      log('Applied Neovim theme, but macOS appearance not changed.', vim.log.levels.WARN)
    end
  end)
end

function M.dark() switch(true) end

function M.light() switch(false) end

function M.toggle()
  check_macos(function (is_macos)
    if is_macos then
      detect_macos_dark(function (is_dark)
        if is_dark == nil then
          -- fallback: look at current background
          local bgdark = (vim.o.background == 'dark')
          switch(not bgdark)
        else
          switch(not is_dark)
        end
      end)
    else
      local bgdark = (vim.o.background == 'dark')
      switch(not bgdark)
    end
  end)
end

local function auto_set()
  check_macos(function (is_macos)
    if is_macos then
      detect_macos_dark(function (is_dark)
        vim.schedule(function ()
          if is_dark == nil then
            log('failed to detect current macos color theme')
          else
            apply_neovim_theme(is_dark)
          end
        end)
      end)
    else
      log('Non-macOS: Neovim background=' .. vim.o.background)
    end
  end)
end

local function create_commands()
  vim.api.nvim_create_user_command('DarkTheme', M.dark, { desc = 'Set macOS + Neovim to dark theme' })
  vim.api.nvim_create_user_command('LightTheme', M.light, { desc = 'Set macOS + Neovim to light theme' })
  vim.api.nvim_create_user_command('ToggleTheme', M.toggle, { desc = 'Toggle macOS + Neovim theme' })
end

function M.setup(user_cfg)
  if user_cfg then
    cfg = vim.tbl_deep_extend('force', cfg, user_cfg)
  end
  create_commands()
  auto_set()
end

return M

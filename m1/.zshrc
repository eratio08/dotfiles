export ZSH="$HOME/.oh-my-zsh"

plugins=(
  evalcache # git clone https://github.com/mroth/evalcache ~/.oh-my-zsh/custom/plugins/evalcache
  git
  brew
  golang
  nmap
  asdf
)

export FZF_DEFAULT_COMMAND='rg'

source $ZSH/oh-my-zsh.sh

fpath=("~/.zsh_completions" $fpath)

######################
# User configuration #
######################

# Starship config
export STARSHIP_CONFIG="$HOME/.config/startship/config.toml"

# Set preferred editor
export EDITOR='nvim'

# do not store duplicates in history
export HISTCONTROL=ignoredups

# Use vim style command history editing
set o -vi

# Bitwarden SSH Agent
export SSH_AUTH_SOCK="$HOME/Library/Containers/com.bitwarden.desktop/Data/.bitwarden-ssh-agent.sock"

# aliases
alias vim="nvim"
alias cat="bat -p"
alias ls="eza -la"
alias tree="eza -T"
alias lzd="lazydocker"
alias lzg="lazygit"
# alias find="fd"
alias zrl="source ~/.zshrc"
alias tf="tofu"
alias jo="joshuto"
alias toggle="~/dotfiles/darktoggle.swift"

# asdf
# export PATH="${ASDF_DATA_DIR:-$HOME/.asdf}/shims:$PATH"

# NVM
export NVM_DIR="$HOME/.nvm"
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"  # This loads nvm
[ -s "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm" ] && \. "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm"  # This loads nvm bash_completion

# Rust
source "$HOME/.asdf/installs/rust/1.87.0/env"

# Ruby
export PATH="/opt/homebrew/opt/ruby/bin:$PATH"
export LDFLAGS="-L/opt/homebrew/opt/ruby/lib"
export CPPFLAGS="-I/opt/homebrew/opt/ruby/include"
export PKG_CONFIG_PATH="/opt/homebrew/opt/ruby/lib/pkgconfig"

# pnpm
# export PNPM_HOME="$HOME/Library/pnpm"
# export PATH="$PNPM_HOME:$PATH"

# Tell macOS about XDG_CONFIG_HOME
export XDG_CONFIG_HOME=~/.config/

# Go
source ~/.asdf/plugins/golang/set-env.zsh
# export PATH="$HOME/go/bin:$PATH"
# export PATH="$GOBIN:$PATH"

# OCaml
# [[ ! -r /Users/el/.opam/opam-init/init.zsh ]] || source /Users/el/.opam/opam-init/init.zsh  > /dev/null 2> /dev/null
# dune
source $HOME/.dune/env/env.zsh

# Roc
export PATH=$PATH:~/Downloads/roc-lang/roc_nightly-macos_apple_silicon-2024-07-13-070d14a5d60

# load openapi key
[[ -f "$HOME/dotfiles/private-dotfiles/openai.sh" ]] && source "$HOME/dotfiles/private-dotfiles/openai.sh"

# Nix
if [ -e '/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh' ]; then
  . '/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh'
fi

# Starship
_evalcache starship init zsh

# Atuin
_evalcache atuin init zsh

# postgres
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"

#THIS MUST BE AT THE END OF THE FILE FOR SDKMAN TO WORK!!!
export SDKMAN_DIR="$HOME/.sdkman"
[[ -s "$HOME/.sdkman/bin/sdkman-init.sh" ]] && source "$HOME/.sdkman/bin/sdkman-init.sh"

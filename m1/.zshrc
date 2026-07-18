export ZSH="$HOME/.oh-my-zsh"

plugins=(
  evalcache # git clone https://github.com/mroth/evalcache ~/.oh-my-zsh/custom/plugins/evalcache
  git
  brew
  golang
  nmap
  asdf
  jj
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
alias k="kubectl"

# Rust
export RUST_WITHOUT=rust-docs # do not install rust-docs with asdf

# Tell macOS about XDG_CONFIG_HOME
export XDG_CONFIG_HOME=~/.config/

# Go
. ${ASDF_DATA_DIR:-$HOME/.asdf}/plugins/golang/set-env.zsh
export PATH=$PATH:$GOBIN

# OCaml
[[ ! -r ~/.opam/opam-init/init.zsh ]] || source ~/.opam/opam-init/init.zsh > /dev/null 2> /dev/null

# dune
source $HOME/.local/share/dune/env/env.zsh

# Nix
if [ -e '/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh' ]; then
  . '/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh'
fi

# Starship
_evalcache starship init zsh

# Atuin
_evalcache atuin init zsh

# zoxide
_evalcache zoxide init zsh
alias cd="z"

# postgres
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"

# pi
export PATH="$HOME/.bun/bin:$PATH"

export ZSH="$HOME/.oh-my-zsh"

# ZSH_THEME="powerlevel10k/powerlevel10k"

plugins=(git docker kubectl aws mvn gradle terraform helm)

source $ZSH/oh-my-zsh.sh

#################
## CUSTOM STUFF##
#################
#
# Starship config
export STARSHIP_CONFIG="$HOME/.config/startship/config.toml"

fpath+=~/.zfunc

# do not store duplicates in history
export HISTCONTROL=ignoredups

# Use vim style command history editing
set o -vi

# Git helper
clean_merged() {
    git branch --merged | grep -v "\*" | xargs -n 1 git branch -D
}

clean_unmerged() {
    git branch --no-merged | grep -v "\*" | xargs -n 1 git branch -D
}

# Tell macOS about XDG_CONFIG_HOME
export XDG_CONFIG_HOME=~/.config/

# Set default editor
export EDITOR=nvim

# Linux Helpers
alias untar="tar -zxvf"
alias logoff="pkill -u $USER"

# Aliases
alias fn-lock="echo 2 | sudo tee -a /sys/module/hid_apple/parameters/fnmode"
alias fn-lock-off="echo 1 | sudo tee -a /sys/module/hid_apple/parameters/fnmode"
alias fix-suspend="sudo echo XHC1 > /proc/acpi/wakeup"
alias ls="eza -lah --icons"
alias cat="bat -p"
alias vim="nvim"
alias code="codium"
alias lzd="lazydocker"
alias lzg="lazygit"
alias btm="btm --mem_as_value"
alias rlz="source ~/.zshrc"

# Rust
export PATH=~/.cargo/bin:$PATH

# fzf support
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh

# load work helpers
SPA_HELPERS=~/spa-helpers.sh
if [ -f "$SPA_HELPERS" ]; then
  source "$SPA_HELPERS"
  echo "Loaded SPA Helpers"
fi

# node version manager
export NVM_DIR="$HOME/.nvm"
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"  # This loads nvm
[ -s "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm" ] && \. "/opt/homebrew/opt/nvm/etc/bash_completion.d/nvm"  # This loads nvm bash_completion


# Go
export GOPATH=$HOME/go
export PATH=$PATH:$GOPATH/bin

# pnpm
export PNPM_HOME="/home/el/.local/share/pnpm"
export PATH="$PNPM_HOME:$PATH"

# local binaries
export PATH=~/.local/bin:$PATH

# add pg tools to path
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"

# for mvn daemon as it collides with zsh plugin
# unalias mvnd

# use pod man as docker runtime
# export DOCKER_HOST='unix:///Users/el/.local/share/containers/podman/machine/qemu/podman.sock'

# use colima
# export DOCKER_HOST="unix://${XDG_CONFIG_HOME}/colima/default/docker.sock"

# To customize prompt, run `p10k configure` or edit ~/.p10k.zsh.
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh

# Use 1Password Agent
export SSH_AUTH_SOCK=~/.1password/agent.sock

# Starship
eval "$(starship init zsh)"

# opam configuration
[[ ! -r /Users/el/.opam/opam-init/init.zsh ]] || source /Users/el/.opam/opam-init/init.zsh  > /dev/null 2> /dev/null

# atuin
eval "$(atuin init zsh)"

#THIS MUST BE AT THE END OF THE FILE FOR SDKMAN TO WORK!!!
export SDKMAN_DIR="$HOME/.sdkman"
[[ -s "$HOME/.sdkman/bin/sdkman-init.sh" ]] && source "$HOME/.sdkman/bin/sdkman-init.sh"

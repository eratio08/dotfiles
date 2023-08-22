# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

# If you come from bash you might have to change your $PATH.
# export PATH=$HOME/bin:/usr/local/bin:$PATH

# Path to your oh-my-zsh installation.
export ZSH="$HOME/.oh-my-zsh"

# Set name of the theme to load --- if set to "random", it will
# load a random theme each time oh-my-zsh is loaded, in which case,
# to know which specific one was loaded, run: echo $RANDOM_THEME
# See https://github.com/ohmyzsh/ohmyzsh/wiki/Themes
# ZSH_THEME="norm"
ZSH_THEME="powerlevel10k/powerlevel10k"

# Which plugins would you like to load?
# Standard plugins can be found in ~/.oh-my-zsh/plugins/*
# Custom plugins may be added to ~/.oh-my-zsh/custom/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
plugins=(git docker kubectl aws mvn gradle terraform helm)

source $ZSH/oh-my-zsh.sh

#################
## CUSTOM STUFF##
#################

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
alias ls="exa -lah"
alias cat="bat"
alias vim="nvim"
alias code="codium"

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
export DOCKER_HOST="unix://${HOME}/.colima/docker.sock"

# To customize prompt, run `p10k configure` or edit ~/.p10k.zsh.
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh

# Use 1Password Agent
export SSH_AUTH_SOCK=~/.1password/agent.sock

#THIS MUST BE AT THE END OF THE FILE FOR SDKMAN TO WORK!!!
export SDKMAN_DIR="$HOME/.sdkman"
[[ -s "$HOME/.sdkman/bin/sdkman-init.sh" ]] && source "$HOME/.sdkman/bin/sdkman-init.sh"

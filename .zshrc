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
if [[ "$OSTYPE" == "darwin"* ]]; then
    plugins=(git docker kubectl docker-compose aws mvn gradle terraform helm)
else
    plugins=(git archlinux sdk docker docker-compose rust)
fi

source $ZSH/oh-my-zsh.sh

#################
## CUSTOM STUFF##
#################

fpath+=~/.zfunc

## SSH Agent
load-ssh-agent() {
  if [ -f ~/.ssh/agent.env ] ; then
      . ~/.ssh/agent.env > /dev/null
      if ! kill -0 $SSH_AGENT_PID > /dev/null 2>&1; then
          echo "Stale agent file found. Spawning new agent… "
          eval `ssh-agent | tee ~/.ssh/agent.env`
          ssh-add
      fi
  else
      echo "Starting ssh-agent"
      eval `ssh-agent | tee ~/.ssh/agent.env`
      ssh-add
  fi
}
load-ssh-agent

## GPG Key for Git
kill-gpg-agent() {
  echo "Killing GPG Agent..."
  gpgconf --kill gpg-agent
}
load-gpg() {
  export GPG_TTY=$(tty)
}
load-gpg

# Linux Helpers
alias untar="tar -zxvf"
alias logoff="pkill -u $USER"

# JVM
export JAVA_HOME=~/.sdkman/candidates/java/current

# Snap bin
export PATH=/snap/bin:$PATH

# Git helper
remove_merged() {
    git branch --merged | grep -v "\*" | xargs -n 1 git branch -D
}

remove_unmerged() {
    git branch --no-merged | grep -v "\*" | xargs -n 1 git branch -D
}

function config {
   /usr/bin/git --git-dir=$HOME/.cfg/ --work-tree=$HOME $@
}

# Set default editor
export EDITOR=nvim

# IntelliJ
# export IDEA_JDK=/usr/lib/jvm/jetbrains-jre
export _JAVA_AWT_WM_NONREPARENTING=1
export GDK_BACKEND=wayland

# Aliases
alias fn-lock="echo 2 | sudo tee -a /sys/module/hid_apple/parameters/fnmode"
alias fn-lock-off="echo 1 | sudo tee -a /sys/module/hid_apple/parameters/fnmode"
alias fix-suspend="sudo echo XHC1 > /proc/acpi/wakeup"
alias ls="exa -lah"
alias cat="bat"
alias vim="nvim"
alias code="vscodium"

# Rust helpers
new-sea-orm-migration () {
  local migration_name=$1
  local file_name=m"$(date +'%Y%m%d_%H%M%S')"_"$migration_name".rs
  touch ./migration/src/"${file_name}"
}
export PATH=~/.cargo/bin:$PATH

# enable wayland support for firefox
export MOZ_ENABLE_WAYLAND=1

# fzf support
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh

# load work helpers
SPA_HELPERS=./private-dotfiles/spa-helpers.sh
[ -f "$SPA_HELPERS" ] && source "$SPA_HELPERS"

# node version manager
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

# To customize prompt, run `p10k configure` or edit ~/.p10k.zsh.
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh

#THIS MUST BE AT THE END OF THE FILE FOR SDKMAN TO WORK!!!
export SDKMAN_DIR="$HOME/.sdkman"
[[ -s "$HOME/.sdkman/bin/sdkman-init.sh" ]] && source "$HOME/.sdkman/bin/sdkman-init.sh"

export PNPM_HOME="/home/el/.local/share/pnpm"
export PATH="$PNPM_HOME:$PATH"

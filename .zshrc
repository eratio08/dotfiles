# If you come from bash you might have to change your $PATH.
# export PATH=$HOME/bin:/usr/local/bin:$PATH

# Path to your oh-my-zsh installation.
export ZSH="/home/el/.oh-my-zsh"

# Set name of the theme to load --- if set to "random", it will
# load a random theme each time oh-my-zsh is loaded, in which case,
# to know which specific one was loaded, run: echo $RANDOM_THEME
# See https://github.com/ohmyzsh/ohmyzsh/wiki/Themes
ZSH_THEME="norm"

# Set list of themes to pick from when loading at random
# Setting this variable when ZSH_THEME=random will cause zsh to load
# a theme from this variable instead of looking in ~/.oh-my-zsh/themes/
# If set to an empty array, this variable will have no effect.
# ZSH_THEME_RANDOM_CANDIDATES=( "robbyrussell" "agnoster" )

# Uncomment the following line to use case-sensitive completion.
# CASE_SENSITIVE="true"

# Uncomment the following line to use hyphen-insensitive completion.
# Case-sensitive completion must be off. _ and - will be interchangeable.
# HYPHEN_INSENSITIVE="true"

# Uncomment the following line to disable bi-weekly auto-update checks.
# DISABLE_AUTO_UPDATE="true"

# Uncomment the following line to automatically update without prompting.
# DISABLE_UPDATE_PROMPT="true"

# Uncomment the following line to change how often to auto-update (in days).
# export UPDATE_ZSH_DAYS=13

# Uncomment the following line if pasting URLs and other text is messed up.
# DISABLE_MAGIC_FUNCTIONS=true

# Uncomment the following line to disable colors in ls.
# DISABLE_LS_COLORS="true"

# Uncomment the following line to disable auto-setting terminal title.
# DISABLE_AUTO_TITLE="true"

# Uncomment the following line to enable command auto-correction.
# ENABLE_CORRECTION="true"

# Uncomment the following line to display red dots whilst waiting for completion.
# COMPLETION_WAITING_DOTS="true"

# Uncomment the following line if you want to disable marking untracked files
# under VCS as dirty. This makes repository status check for large repositories
# much, much faster.
# DISABLE_UNTRACKED_FILES_DIRTY="true"

# Uncomment the following line if you want to change the command execution time
# stamp shown in the history command output.
# You can set one of the optional three formats:
# "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
# or set a custom format using the strftime function format specifications,
# see 'man strftime' for details.
# HIST_STAMPS="mm/dd/yyyy"

# Would you like to use another custom folder than $ZSH/custom?
# ZSH_CUSTOM=/path/to/new-custom-folder

# Which plugins would you like to load?
# Standard plugins can be found in ~/.oh-my-zsh/plugins/*
# Custom plugins may be added to ~/.oh-my-zsh/custom/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
plugins=(git vscode archlinux nvm npm npx sdk docker docker-compose)

source $ZSH/oh-my-zsh.sh

# User configuration

# export MANPATH="/usr/local/man:$MANPATH"

# You may need to manually set your language environment
# export LANG=en_US.UTF-8

# Preferred editor for local and remote sessions
# if [[ -n $SSH_CONNECTION ]]; then
#   export EDITOR='vim'
# else
#   export EDITOR='mvim'
# fi

# Compilation flags
# export ARCHFLAGS="-arch x86_64"

# Set personal aliases, overriding those provided by oh-my-zsh libs,
# plugins, and themes. Aliases can be placed here, though oh-my-zsh
# users are encouraged to define aliases within the ZSH_CUSTOM folder.
# For a full list of active aliases, run `alias`.
#
# Example aliases
# alias zshconfig="mate ~/.zshrc"
# alias ohmyzsh="mate ~/.oh-my-zsh"

## SSH Agent
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

## GPG Key for Git
export GPG_TTY=$(tty)



#################
## CUSTOM STUFF##
#################
alias untar="tar -zxvf"

# alias vim="nvim"
# alias vimdiff="nvim -d"
alias logoff="pkill -u $USER"
# alias aura="sudo aura"
# alias update="sudo aura -Syu && sudo aura -Au"

# unalias generate_migration
generate_migration() {
    touch migrations/$(date +%s)-$1.js
}

export JAVA_HOME=/usr/lib/jvm/default

# If you come from bash you might have to change your $PATH.
# export PATH=$HOME/bin:$PATH
# export PATH=/usr/local/bin:$PATH
# export PATH=~/.nix-profile/bin:$PATH
# export PATH=~/.local/bin:$PATH

# NPM bin
export PATH=~/.npm-global/bin:$PATH

# Yarn bin
# export PATH=~/.yarn/bin:$PATH

# Old NPM bin
# export PATH=~/.npm/bin:$PATH

#Nimble
# export PATH=/home/eratio/.nimble/bin:$PATH

# Snap bin
export PATH=/var/lib/snapd/snap/bin:$PATH
# Snap desktops
# export PATH=/var/lib/snapd/desktop:$PATH

#SonarCube Scanner
# export PATH=/home/el/Downloads/SonarScanner/bin:$PATH

# Nu Shell
# export PATH=/home/el/.cargo/bin:$PATH

# Sourcing Stuff
# source /etc/profile.d/nix.sh
# source /etc/profile.d/nix-daemon.sh
# source /etc/profile

# Enable Wayland backends
# QT 5
export QT_QPA_PLATFORM=wayland-egl

# Clutter
export CLUTTER_BACKEND=wayland

# Java Wayland Support
export _JAVA_AWT_WM_NONREPARENTING=1
# wmname LG3D
# export XDG_WM_NON_REPARENTING=1

# firefox wayland
export MOZ_ENABLE_WAYLAND=1

# enabled wayland for chrome
# export GDK_BACKEND=wayland

remove_merged() {
    git branch --merged | grep -v "\*" | xargs -n 1 git branch -d
}

remove_unmerged() {
    git branch --no-merged | grep -v "\*" | xargs -n 1 git branch -D
}

# Set default editor
# export EDITOR=code

# NVM
source /usr/share/nvm/init-nvm.sh
# export NVM_DIR=~/.nvm

# IntelliJ
export IDEA_JDK=/usr/lib/jvm/jetbrains-jre

#!/usr/bin/zsh
set -eu

link_to() {
    if [ ! -e $2 ] 
    then
        print -P "%F{2}linking%f %B$1%b %F{2}to%f %B$2%b"
        ln -s $1 $2
    else 
        print -P "%F{1}skipping%f %B$2%b %F{1}already existing%f"
    fi
}


# Configs
link_to_config() {
    link_to $PWD/$1 $HOME/.config/$1
}

configs=(
    'alacritty' 
    'environment.d' 
    'hunter' 
    'mako' 
    'redshift'
    'sway' 
    'swaylock'
    'waybar'
    )

for config in $configs
do
    link_to_config $config
done

# Others
link_to_home() {
    link_to $PWD/$1 $HOME/$1
}

files=('.zshrc' '.Xresources')

for file in $files
do
    link_to_home $file
done
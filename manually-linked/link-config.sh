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

config_files=(
    'alacritty' 
    'environment.d' 
    'hunter' 
    'mako' 
    'redshift'
    'sway' 
    'swaylock'
    'waybar'
    )

for file in $config_files
do
    link_to_config $file
done

# Links to home
link_to_home() {
    link_to $PWD/$1 $HOME/$1
}

home_files=('.zshrc' '.ghci')

for file in $home_files
do
    link_to_home $file
done

#links to etc
link_to_etc() {
    link_to $PWD/$1 /etc/$1
}

 etc_files=('tlp.conf' 'mbpfan.conf')

 zsudo() { 
    print -P "%BSudo%b is required for next action" 
    sudo zsh -c "$(functions); $1 $2"
}

 for file in $etc_files
 do
   zsudo link_to_etc $file
 done
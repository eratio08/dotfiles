#!/bin/zsh

# use stow to 'install' dotfiles
# see https://zsh.sourceforge.io/Doc/Release/Expansion.html#Glob-Qualifiers
for file in .config/**/*(/); 
  stow --dir .config --target ~/.config $file

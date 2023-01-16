#!/bin/zsh

local SETUP = $0
local STOWS
case $SETUP in 
  "manjaro")
    STOWS=("nvim" "mako" "sway" "swaylock" "waybar" "tmux" "lvim" "manjaro")
    ;;
  "spa")
    STOWS=("nvim" "tmux" "lvim" "spa")
    ;;
  "asahi")
    STOWS=("nvim" "mako" "sway" "swaylock" "waybar" "tmux" "lvim" "asahi")
    ;;
  *)
    print "Unknown setup"
    exit 1
  ;;
esac

for pkg in $STOWS; 
  stow $pkg

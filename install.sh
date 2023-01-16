#!/bin/zsh

local SETUP = $0
local STOWS
case $SETUP in 
  "manjaro")
    STOWS=("nvim" "mako" "sway" "swaylock" "waybar" "tmux" "lvim" "manjaro")
    ;;
  "asahi")
    STOWS=("nvim" "mako" "sway" "swaylock" "waybar" "tmux" "lvim" "asahi")
    ;;
  "spa")
    STOWS=("nvim" "tmux" "lvim" "spa")
    ;;
  "m1")
    STOWS=("nvim" "tmux" "lvim" "m1")
    ;;
  *)
    print "Unknown setup"
    exit 1
  ;;
esac

for pkg in $STOWS; 
  stow $pkg

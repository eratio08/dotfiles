#!/usr/bin/env zsh

# Install skhd
brew install koekeishiya/formulae/skhd
# Start skhd
brew services start skhd
# Install yabai
brew install koekeishiya/formulae/yabai
# Start yabai
brew services start yabai

# Example configs
# cp /opt/homebrew/opt/yabai/share/yabai/examples/yabairc ~/.yabairc
# cp /opt/homebrew/opt/yabai/share/yabai/examples/skhdrc ~/.skhdrc

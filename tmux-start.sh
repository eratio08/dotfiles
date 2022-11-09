#!/bin/sh

SESSION=$USER

tmux new-session -s $SESSION -d
tmux rename-window "~" 
tmux new-window -n "rpi" -c ~/src/pi-architecture/rpi4
tmux new-window -n "nvim" -c ~/.config/nvim
tmux new-window -n "go" -c ~/src/go
# tmux new-window -n "rust" -c ~/src/rust
# tmux new-window -n "elm"  -c ~/src/elm

tmux attach-session -t $SESSION

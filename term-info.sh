#!/bin/sh

set -x

tmux show-options -AgHpsw default-command
tmux show-options -AgHpsw default-terminal
echo "TERM=$TERM"
echo "TERMINFO=$TERMINFO"
echo "TERMINFO_DIRS=$TERMINFO_DIRS"
infocmp -D
infocmp tmux
infocmp tmux-256color
ls ~/.terminfo

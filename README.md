# 🔵 Dotfiles 

This repo uses the ['bare repo' approach](https://www.atlassian.com/git/tutorials/dotfiles) to manage dotfiles.

For a fresh install use the following commands
```shell
alias config='/usr/bin/git --git-dir=$HOME/.cfg/ --work-tree=$HOME'
echo ".cfg" >> .gitignore
git clone --bare https://github.com/eratio08/dotfiles $HOME/.cfg
config checkout
```

If some default config are in the way use
```shell
mkdir -p .config-backup && \
config checkout 2>&1 | egrep "\s+\." | awk {'print $1'} | \
xargs -I{} mv {} .config-backup/{}
```

---

## 🐧 Archlinux on MacBookPro11.1 🍎

### 🧑‍💻 Software

* [Sway](https://github.com/swaywm/sway) - windows manager
* [Mako](https://github.com/emersion/mako) - notifications
* [Hunter](https://github.com/rabite0/hunter) / [joshuto](https://github.com/kamiyaa/joshuto) - terminal file browser
* [Redshift](https://github.com/jonls/redshift) - reduces blue light
* [Alacritty](https://github.com/alacritty/alacritty) - terminal emulator in rust
* [Swaylock](https://github.com/swaywm/swaylock) - screen locker for sway
* [Waybar](https://github.com/Alexays/Waybar) - status bar for wayland
* [macbook-lighter](https://github.com/harttle/macbook-lighter) - screen/keyboard backlight helper

### Steps

Setup via BT tethering as WiFi will not work yet.

Optimize pacman mirros for germany. 
```shell
sudo pacman-mirrors -c Germany
```

Install yay
```shell
sudo pacman -S yay
```

Install WiFi driver 
```shell
broadcom-wl-dkms
```

WiFi should work now

Install dev package (used by some AUR packages)
```shell
yay -S base-devel
```

Install main font
```shell
yay -S ttf-jetbrains-mono
```

Install sway and the rest
```shell
yay -S sway swayidle swaylock swaybg waybar mako alacritty hunter redshift-wayland-git
```

Install oh-my-zsh
```shell
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
``` 

Install tlp for laptop power management
```shell
yay -S tlp
```

---

## Dev Stuff

Node Version Manager, Rustup
```shell
yay -S nvm rustup
```

SDKMAN
```shell
curl -s "https://get.sdkman.io" | bash 
```

---

### 🪟 Sway

For more information use:
```shell
man 5 sway
```

### Mako

Test mako styling with
```shell
notify-send 'Hello world!' 'This is an example notification.'
```

### 💨 Fan Controll

Use [mbpfan](https://github.com/linux-on-mac/mbpfan) as of 2020-05-30 only the repo version (self build) works

If it got fixed use:
```shell
yay -S mbpfan-git
```

### ⌨️ Keyboard

#### Fn Keys
To disable fn-look use:

```
echo 2 | sudo tee -a /sys/module/hid_apple/parameters/fnmode
``` 

Or use the alias:

```shell
alias fn-lock="echo 2 | sudo tee -a /sys/module/hid_apple/parameters/fnmode"
alias fn-lock-off="echo 1 | sudo tee -a /sys/module/hid_apple/parameters/fnmode"

fn-lock
fn-lock-off
```

### 🔋 Immediate Wake Up after Standby Issue

There is an issue with the power management where the os wakes up immediately after standby sometimes.

Check the wake up settings with 

```shell
cat /proc/acpi/wakeup
```

Most of the time the offender is the `XHC1`.
Disable it using:

```shell
echo XHC1 > /proc/acpi/wakeup
```

---

## References

* [NeoVim Quick Ref](https://neovim.io/doc/user/quickref.html)
* [Vim Guide](https://danielmiessler.com/study/vim/)

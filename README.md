# 🐧 Archlinux on MacBookPro11.1 🍎

## 🧑‍💻 Software

* [Sway](https://github.com/swaywm/sway) - windows manager
* [Mako](https://github.com/emersion/mako) - notifications
* [Hunter](https://github.com/rabite0/hunter) - terminal file browser
* [Redshift](https://github.com/jonls/redshift) - reduces blue light
* [Alacritty](https://github.com/alacritty/alacritty) - terminal emulator in rust
* [Swaylock](https://github.com/swaywm/swaylock) - screen locker for sway
* [Waybar](https://github.com/Alexays/Waybar) - status bar for wayland
* [macbook-lighter](https://github.com/harttle/macbook-lighter) - screen/keyboard backlight helper

## Steps

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

Optional: Use linux kernel for macbooks
```shell
yay -S linux-macbook
```

### Dev Stuff

Node Version Manager, Rustup
```shell
yay -S nvm rustup
```

SDKMAN
```shell
curl -s "https://get.sdkman.io" | bash 
```

## Link configuration files

Create links to `.config` and resources located in `$HOME`

```shell
chmod +x link-config.sh && ./link-config.sh
```

## 🪟 Sway

For more information use:
```shell
man 5 sway
```

## Mako

Test mako styling with
```shell
notify-send 'Hello world!' 'This is an example notification.'
```

## 🎶 Spotify
A light weight alternative to the electron client it `spotify-tui` + `spotifyd`. 
To setup `spotify-tui` follow the [instruction](https://github.com/Rigellute/spotify-tui#connecting-to-spotifys-api) shown in the repo.
To actually play something you need to setup `spotifyd` as a backend.
The [instructions](https://github.com/Spotifyd/spotifyd#configuration-file) are found in the repo.

## 💨 Fan Controll

Use [mbpfan](https://github.com/linux-on-mac/mbpfan) as of 2020-05-30 only the repo version (self build) works

If it got fixed use:
```shell
yay -S mbpfan-git
```

## ⌨️ Keyboard

### Fn Keys
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

## 🔋 Immediate Wake Up after Standby Issue

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

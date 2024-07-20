# 🔵 Dotfiles

This repository uses `stow` to manage the dotfile.
`stow` will manage the symbolic linking.
For this reason each `package` has to contain the target directory structure.

To link a `package` run

```shell
cd dotfiles
stow nvim
```

This will only work if `/dotfile` is located in `~/`.

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
yay -S nerd-fonts-jetbrains-mono
```

Install sway and the rest
```shell
yay -S sway swayidle swaylock swaybg waybar mako alacritty hunter redshift-wayland-git
```

Install oh-my-zsh
```shell
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
```

Install [powerlevel10k](https://github.com/romkatv/powerlevel10k#oh-my-zsh)
```shell
git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k
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

Elliptic Curve SSH Key ([source](https://cryptsus.com/blog/how-to-secure-your-ssh-server-with-public-key-elliptic-curve-ed25519-crypto.html))
```shell
ssh-keygen -o -a 256 -t ed25519 -C "$(hostname)-$(date +'%d-%m-%Y')"
```

Elliptic Curve GPG Key ([source](https://www.gniibe.org/memo/software/gpg/keygen-25519.html))
```shell
gpg2 --expert --full-gen-key
```

Also checkout the [Archwiki gpg page](https://wiki.archlinux.org/title/GnuPG) about how to configure `pinentry-tty` to allow gpg key password in shell.

---

### 🪟 Sway

For more information use:
```shell
man 5 sway
```

### 📔 Mako

Test mako styling with
```shell
notify-send 'Hello world!' 'This is an example notification.'
```

### 💨 Fan Control

Use [mbpfan](https://github.com/linux-on-mac/mbpfan) as of 2020-05-30 only the repo version (self build) works

If it got fixed use:
```shell
yay -S mbpfan-git
```

### 🗄 Restic

Use the following crontab to schedule the backups.
When using cronie/anachron make sure to not include the `.sh`.

```shell
# mm hh DD MM W
0  6-23/2  *  *  * /home/.../backup
```

### 🦊 Firefox

To force darkmode on websites, visit `about:config` and create a new entry with the value of `1`.

```shell
ui.systemUsesDarkTheme
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

## Linux tools in Rust

* `eza` instead of `ls`
* `bat` instead of `cat`
* `bottom` instead of `top`
* `tokei` for source code statistics
* `ripgrep` better grep
* `fd` better find

_Planned_
* `zoxide` smart cd


---

## References

* [NeoVim Quick Ref](https://neovim.io/doc/user/quickref.html)
* [Vim Guide](https://danielmiessler.com/study/vim/)
* [External Monitor Brightness Control](https://lyndeno.ca/posts/setting-up-external-monitor-brightness)

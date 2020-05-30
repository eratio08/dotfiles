# Archlinux on MacBookPro11.1

## Software

* Sway - windows manager
* Mako - notifications
* Hunter - terminal file browser
* Redshift - reduces blue light
* Alacritty - terminal emulator in rust
* Swaylock - screen locker for sway
* Waybar - status bar for wayland

## Steps

Setup via BT tethering as WIFI will not work yet.

Optimize pacman mirros for germany. 
```Shell
sudo pacman-mirrors -c Germany
```

Install yay
```Shell
sudo pacman -S yay
```

Install WIFI driver 
```
broadcom-wl-dkms
```

Wifi should work now

Install dev package (used by some AUR packages)
```Shell
yay -S base-devel
```

Install main font
```Shell
yay -S ttf-jetbrains-mono
```

Install sway and the rest
```Shell
yay -S sway swayidle swaylock swaybg waybar mako alacritty hunter redshift-wayland-git
```

Install oh-my-zsh
```Shell
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
``` 

Install tlp for laptop power management
```Shell
yay -S tlp
```

Optional: Use linux kernal for macbooks
```Shell
yay -S linux-macbook
```

### Dev Stuff

Node Version Manager, Rustup
```Shell
yay -S nvm rustup
```

SDKMAN
```Shell
curl -s "https://get.sdkman.io" | bash 
```

## Link configuration files

Create links to `.config` and resources located in `$HOME`

```Shell
chmod +x link-config.sh && ./link-config.sh
```

## Sway

Use for more informations
```
man 5 sway
```
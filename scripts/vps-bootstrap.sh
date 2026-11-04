#!/usr/bin/env bash
# One-time VPS setup: firewall, unattended security updates, Dokploy.
# Run as root on a fresh Ubuntu 22.04/24.04 box (>= 2 GB RAM, 30 GB disk):
#   curl -fsSL https://raw.githubusercontent.com/Soteria-Privacy/soteria/main/scripts/vps-bootstrap.sh | bash
#   (or scp it over and run: bash vps-bootstrap.sh)
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }

echo "==> system updates"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
DEBIAN_FRONTEND=noninteractive apt-get install -y ufw fail2ban unattended-upgrades curl
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> firewall (ssh, http, https, dokploy panel)"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp   # Dokploy panel — close this once the panel has its own domain
ufw --force enable
systemctl enable --now fail2ban

echo "==> installing Dokploy (Docker + Traefik + panel)"
curl -sSL https://dokploy.com/install.sh | sh

IP="$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"
echo
echo "Done. Open http://$IP:3000 and create the admin account immediately."
echo "Note: Docker-published ports bypass ufw; the compose stack publishes none."

#!/usr/bin/env bash
# Phase 7 — one-time Alibaba Cloud ECS setup (Ubuntu 24.04 / Debian 12).
# Installs Docker Engine + compose plugin, prepares /opt/aioption.
# Run with sudo:  sudo bash deploy/ecs/setup.sh
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo 'run as root (sudo)' >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends ca-certificates curl gnupg rsync unattended-upgrades

# Docker's official apt repository.
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.asc ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi
# shellcheck disable=SC1091
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker

# App directory owned by the invoking (sudo) user so deploys need no root.
install -d -m 0755 -o "${SUDO_USER:-root}" -g "${SUDO_USER:-root}" /opt/aioption

# Unattended security upgrades.
dpkg-reconfigure -f noninteractive unattended-upgrades || true

echo 'setup complete — next: ./deploy/ecs/deploy.sh from your machine, then create /opt/aioption/.env'

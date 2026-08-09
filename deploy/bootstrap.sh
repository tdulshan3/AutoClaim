#!/usr/bin/env bash
# Runs once on a fresh OCI Ubuntu instance to prepare it for AutoClaim.
# Idempotent - safe to re-run.
set -euo pipefail

echo ">>> swap"
# The Always Free shapes are small, and a Vite build on 1 GB will OOM without
# this. Harmless on the larger Ampere shape.
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
fi
free -h

echo ">>> docker"
if ! command -v docker > /dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER"
fi
sudo systemctl enable --now docker
docker --version
docker compose version

echo ">>> app directory"
mkdir -p ~/autoclaim/server/data
chmod 700 ~/autoclaim/server/data

# The OCI Ubuntu image ships restrictive iptables rules; nothing extra is
# opened here on purpose. The app publishes only to the VM's own loopback and
# is reached through an SSH tunnel, so it has no exposure to the internet even
# if the cloud security list were later widened by accident.
echo ">>> done"

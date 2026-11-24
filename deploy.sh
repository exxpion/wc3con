#!/usr/bin/env bash
set -euo pipefail

# Usage: REPO_URL=https://github.com/owner/repo.git bash deploy.sh
if [[ -z "${REPO_URL:-}" ]]; then
  echo "Set REPO_URL to the Git repository URL before running this script."
  exit 1
fi

APP_DIR="${APP_DIR:-/opt/wc3-connector}"
NODE_MAJOR=20

sudo apt-get update
sudo apt-get install -y ca-certificates curl git build-essential python3
curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

sudo mkdir -p "$APP_DIR"
sudo chown "$USER":"$USER" "$APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
if [[ ! -f server/.env ]]; then
  cat > server/.env <<ENV
PORT=3000
HOST=127.0.0.1
JWT_SECRET=$(openssl rand -base64 48)
NODE_ENV=production
ENV
  chmod 600 server/.env
  echo "Created server/.env. Back it up securely; do not publish JWT_SECRET."
fi

# Install server workspace including TypeScript build tools, compile, then prune dev tools.
npm ci --workspace=server --include-workspace-root=false
npm run build --workspace=server
npm prune --omit=dev --workspace=server

cd server
pm2 delete wc3-server >/dev/null 2>&1 || true
pm2 start dist/index.js --name wc3-server
pm2 save

sudo ufw allow 22/tcp
sudo ufw allow 3000/tcp

sleep 2
curl --fail http://127.0.0.1:3000/health

echo "Deployment complete. Configure HTTPS/WSS reverse proxy before public production use."

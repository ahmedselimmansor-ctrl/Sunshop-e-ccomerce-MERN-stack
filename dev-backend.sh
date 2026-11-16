#!/usr/bin/env sh
# ─────────────────────────────────────────────────────────────────────────────
# Starts local development backend services:
# data services (docker) + the API on http://localhost:4000.
#
# First run only (wipes and reseeds the demo catalogue):
#     ./dev-backend.sh --seed
# ─────────────────────────────────────────────────────────────────────────────
set -eu
cd "$(dirname "$0")"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22.12.0 >/dev/null 2>&1 || nvm use node >/dev/null 2>&1

if ! command -v docker >/dev/null 2>&1; then
  echo "✗ Docker is not installed. Run:"
  echo "    sudo apt install -y docker.io docker-compose-v2"
  echo "    sudo usermod -aG docker \$USER   # then log out and back in"
  exit 1
fi

echo "→ starting data services (mongo, redis, elasticsearch, minio, mailhog)…"
docker compose up -d

if [ "${1:-}" = "--seed" ]; then
  echo "→ seeding demo data…"
  npm run seed -w @sunshop/server
fi

echo "→ starting API on http://localhost:4000 (Ctrl-C to stop)"
npm run dev:api

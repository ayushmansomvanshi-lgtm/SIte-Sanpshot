#!/bin/bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required. Download it from https://nodejs.org"
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -d "node_modules/playwright" ]; then
  echo "First-time setup: installing app packages..."
  npm install
fi

echo "Checking the screenshot browser..."
npx playwright install chromium

echo "Opening Site Snapshotter at http://localhost:4173"
(sleep 1; open "http://localhost:4173") &
npm start

#!/usr/bin/env bash
# ============================================================
#  GamePad Pro v6.0 — GOD MODE ULTIMATE  (Linux/Mac)
# ============================================================

set -e
cd "$(dirname "$0")"

echo ""
echo "  ╔══════════════════════════════════════════════════╗"
echo "  ║  🎮  GamePad Pro v6.0  —  GOD MODE ULTIMATE     ║"
echo "  ╚══════════════════════════════════════════════════╝"
echo ""

# Check Node
if ! command -v node &>/dev/null; then
  echo "  [ERROR] Node.js not found."
  echo "  Install from: https://nodejs.org"
  exit 1
fi
echo "  [OK] Node.js $(node -v)"

# Install packages
if [ ! -d "node_modules/express" ]; then
  echo "  [INFO] Installing packages..."
  npm install
  echo "  [OK] Packages installed!"
fi

# Try robotjs
if ! node -e "require('robotjs')" &>/dev/null 2>&1; then
  echo "  [INFO] Installing robotjs (optional)..."
  npm install robotjs --optional 2>/dev/null || echo "  [WARN] robotjs unavailable — DEMO mode"
fi

echo ""
echo "  Starting server..."
echo ""

# GOD MODE loop
while true; do
  node server.js
  EXIT=$?
  if [ $EXIT -eq 0 ]; then break; fi
  echo ""
  echo "  ⚠  Crashed (code $EXIT). Restarting in 3s... (Ctrl+C to stop)"
  sleep 3
done

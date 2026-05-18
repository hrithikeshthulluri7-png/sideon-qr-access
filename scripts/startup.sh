#!/bin/bash
# ===============================================
# Startup script for SIDEON QR Access Backend
# Validates configuration and starts server
# ===============================================

set -e

echo "=========================================="
echo "SIDEON QR Access Backend - Startup Script"
echo "=========================================="

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js not found. Please install Node.js 18 or higher."
  exit 1
fi
echo "✓ Node.js $(node --version) found"

# Check .env file
if [ ! -f .env ]; then
  if [ -f .env.production ]; then
    cp .env.production .env
    echo "✓ Created .env from .env.production"
  elif [ -f .env.example ]; then
    echo "ERROR: .env file not found. Copy .env.example to .env and configure."
    exit 1
  fi
fi

# Create necessary directories
mkdir -p data logs data/backups
echo "✓ Created required directories"

# Install dependencies if not present
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
  echo "✓ Dependencies installed"
else
  echo "✓ Dependencies already installed"
fi

echo "=========================================="
echo "Startup validation complete"
echo "=========================================="
echo ""
echo "Starting server..."
echo ""

# Start the server
exec node server.js

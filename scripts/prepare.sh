#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"

cd "${COZE_WORKSPACE_PATH}"

echo "Installing Node.js dependencies..."
corepack pnpm install --frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only

echo "Installing Python dependencies..."
node ./scripts/run-python.mjs -m pip install --require-hashes --only-binary=:all: -r requirements-dev.lock

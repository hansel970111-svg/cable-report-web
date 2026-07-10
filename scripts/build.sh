#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"

cd "${COZE_WORKSPACE_PATH}"

echo "Installing dependencies..."
corepack pnpm install --frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only

echo "Building the Next.js project..."
corepack pnpm next build --webpack

echo "Bundling server with tsup..."
corepack pnpm tsup src/server.ts --format cjs --platform node --target node24 --outDir dist --no-splitting --no-minify

echo "Build completed successfully!"

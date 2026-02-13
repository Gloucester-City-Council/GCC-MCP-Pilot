#!/bin/bash
set -euo pipefail

# Only run in Claude Code web environment
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

echo "🚀 Setting up Gloucestershire Democracy MCP Server environment..."

# Install npm dependencies
# Using 'npm install' instead of 'npm ci' to take advantage of container caching
echo "📦 Installing npm dependencies..."
npm install

# Verify critical dependencies
echo "✅ Verifying installation..."
node -e "require('@azure/functions'); require('axios'); require('pdf-parse'); require('xml2js');" 2>/dev/null && echo "✅ All core dependencies verified" || echo "⚠️  Warning: Some dependencies may not have loaded correctly"

echo "✅ Environment setup complete! Ready to develop."

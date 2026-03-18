#!/bin/bash
echo "Clearing all caches..."

# Remove build artifacts
rm -rf dist
rm -rf node_modules/.vite
rm -rf .tauri
rm -rf src-tauri/target

# Clear npm cache (optional)
# npm cache clean --force

echo "Cache cleared! Now run: npm run tauri dev"

#!/bin/bash

cd "$(dirname "$0")"

echo "Updating all app bundle icons..."

# Update release bundle if it exists
if [ -d "src-tauri/target/release/bundle/macos/SIPalyzer.app/Contents/Resources" ]; then
    cp src-tauri/icons/icon.icns "src-tauri/target/release/bundle/macos/SIPalyzer.app/Contents/Resources/icon.icns"
    echo "✓ Updated release bundle icon"
fi

# Update debug bundle if it exists
if [ -d "src-tauri/target/debug/bundle/macos/SIPalyzer.app/Contents/Resources" ]; then
    cp src-tauri/icons/icon.icns "src-tauri/target/debug/bundle/macos/SIPalyzer.app/Contents/Resources/icon.icns"
    echo "✓ Updated debug bundle icon"
fi

# Kill running app
killall -9 SIPalyzer 2>/dev/null && echo "✓ Killed running SIPalyzer app" || echo "No running SIPalyzer app"

# Clear all icon caches
echo "Clearing icon caches..."
killall Finder 2>/dev/null
killall Dock 2>/dev/null
rm -rf ~/Library/Caches/com.apple.iconservices.store 2>/dev/null
rm -rf ~/Library/Caches/com.apple.iconservices 2>/dev/null

# Touch the app bundle to force refresh
if [ -d "src-tauri/target/release/bundle/macos/SIPalyzer.app" ]; then
    touch "src-tauri/target/release/bundle/macos/SIPalyzer.app"
fi
if [ -d "src-tauri/target/debug/bundle/macos/SIPalyzer.app" ]; then
    touch "src-tauri/target/debug/bundle/macos/SIPalyzer.app"
fi

echo ""
echo "Done! Please restart the app to see the new icon."

#!/bin/bash
#
# Bundle SpanDSP and dependencies for distribution
#
# This script copies the SpanDSP library and its dependencies (libtiff, libjpeg)
# from Homebrew and fixes their install names so they work when bundled in the app.
#
# Run this before building for distribution.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VENDOR_LIBS="$PROJECT_ROOT/src-tauri/vendor/libs"

# Detect Homebrew prefix
if [ -d "/opt/homebrew/lib" ]; then
    HOMEBREW_PREFIX="/opt/homebrew"
elif [ -d "/usr/local/lib" ]; then
    HOMEBREW_PREFIX="/usr/local"
else
    echo "Error: Could not find Homebrew installation"
    echo "Install SpanDSP with: brew install spandsp"
    exit 1
fi

echo "Using Homebrew at: $HOMEBREW_PREFIX"
echo "Bundling to: $VENDOR_LIBS"

# Clean and create output directory
rm -rf "$VENDOR_LIBS"
mkdir -p "$VENDOR_LIBS"

# Copy the main libraries
echo "Copying libraries..."
cp "$HOMEBREW_PREFIX/lib/libspandsp.dylib" "$VENDOR_LIBS/" 2>/dev/null || \
    cp "$HOMEBREW_PREFIX/lib/libspandsp.3.dylib" "$VENDOR_LIBS/libspandsp.dylib"

cp "$HOMEBREW_PREFIX/lib/libtiff.dylib" "$VENDOR_LIBS/" 2>/dev/null || \
    cp "$HOMEBREW_PREFIX/lib/libtiff.6.dylib" "$VENDOR_LIBS/libtiff.dylib"

# Check if libjpeg is needed
if otool -L "$VENDOR_LIBS/libspandsp.dylib" | grep -q "libjpeg"; then
    echo "Copying libjpeg (dependency of SpanDSP)..."
    cp "$HOMEBREW_PREFIX/lib/libjpeg.dylib" "$VENDOR_LIBS/" 2>/dev/null || \
        cp "$HOMEBREW_PREFIX/lib/libjpeg.9.dylib" "$VENDOR_LIBS/libjpeg.dylib"
fi

# Check for other dependencies
if otool -L "$VENDOR_LIBS/libtiff.dylib" | grep -q "libzstd"; then
    echo "Copying libzstd (dependency of libtiff)..."
    cp "$HOMEBREW_PREFIX/lib/libzstd.dylib" "$VENDOR_LIBS/" 2>/dev/null || \
        cp "$HOMEBREW_PREFIX/lib/libzstd.1.dylib" "$VENDOR_LIBS/libzstd.dylib"
fi

if otool -L "$VENDOR_LIBS/libtiff.dylib" | grep -q "liblzma"; then
    echo "Copying liblzma (dependency of libtiff)..."
    cp "$HOMEBREW_PREFIX/lib/liblzma.dylib" "$VENDOR_LIBS/" 2>/dev/null || \
        cp "$HOMEBREW_PREFIX/lib/liblzma.5.dylib" "$VENDOR_LIBS/liblzma.dylib"
fi

if otool -L "$VENDOR_LIBS/libtiff.dylib" | grep -q "libwebp"; then
    echo "Copying libwebp (dependency of libtiff)..."
    cp "$HOMEBREW_PREFIX/lib/libwebp.dylib" "$VENDOR_LIBS/" 2>/dev/null || \
        cp "$HOMEBREW_PREFIX/lib/libwebp.7.dylib" "$VENDOR_LIBS/libwebp.dylib"
fi

echo "Fixing install names..."

# Function to fix install names for a library
fix_install_names() {
    local lib="$1"
    local lib_name=$(basename "$lib")
    
    echo "  Fixing $lib_name..."
    
    # Change the library's own install name to use @rpath
    install_name_tool -id "@rpath/$lib_name" "$lib"
    
    # Fix references to other Homebrew libraries
    for dep in "$VENDOR_LIBS"/*.dylib; do
        local dep_name=$(basename "$dep")
        if [ "$dep_name" != "$lib_name" ]; then
            # Try to find and fix the dependency reference
            local old_path=$(otool -L "$lib" | grep "$dep_name" | awk '{print $1}')
            if [ -n "$old_path" ]; then
                install_name_tool -change "$old_path" "@rpath/$dep_name" "$lib"
            fi
            # Also try the versioned name pattern from Homebrew
            local versioned_path=$(otool -L "$lib" | grep -E "$(echo "$dep_name" | sed 's/\.dylib$//')" | awk '{print $1}')
            if [ -n "$versioned_path" ] && [ "$versioned_path" != "@rpath/$dep_name" ]; then
                install_name_tool -change "$versioned_path" "@rpath/$dep_name" "$lib" 2>/dev/null || true
            fi
        fi
    done
}

# Fix all bundled libraries
for lib in "$VENDOR_LIBS"/*.dylib; do
    fix_install_names "$lib"
done

echo ""
echo "Bundled libraries:"
ls -la "$VENDOR_LIBS"

echo ""
echo "Library dependencies:"
for lib in "$VENDOR_LIBS"/*.dylib; do
    echo ""
    echo "$(basename "$lib"):"
    otool -L "$lib" | head -10
done

echo ""
echo "Done! Libraries are ready for bundling."
echo ""
echo "For Tauri builds, add this to tauri.conf.json under 'bundle' > 'macOS':"
echo '  "frameworks": ["./vendor/libs/libspandsp.dylib", "./vendor/libs/libtiff.dylib", ...]'
echo ""
echo "The libraries will be placed in Contents/Frameworks/ in the app bundle."

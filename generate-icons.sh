#!/bin/bash

# XXTCloudControl Icon Generation Script
# Converts SVG to various formats needed for frontend icons

set -e

ASSETS_DIR="assets"
SVG_FILE="$ASSETS_DIR/XXTCloudControl.svg"
OUTPUT_DIR="$ASSETS_DIR/icons"
FRONTEND_PUBLIC="frontend/public"

# Create output directories
mkdir -p "$OUTPUT_DIR"
mkdir -p "$FRONTEND_PUBLIC"

echo "🎨 Generating icons from $SVG_FILE..."

# Check if SVG file exists
if [ ! -f "$SVG_FILE" ]; then
    echo "❌ SVG file not found: $SVG_FILE"
    exit 1
fi

# Generate PNG files for different sizes using rsvg-convert (if available)
if command -v rsvg-convert >/dev/null 2>&1; then
    echo "📱 Generating PNG files..."
    
    # Tray icon sizes
    rsvg-convert -w 16 -h 16 "$SVG_FILE" -o "$OUTPUT_DIR/icon-16.png"
    rsvg-convert -w 32 -h 32 "$SVG_FILE" -o "$OUTPUT_DIR/icon-32.png"
    
    # App icon sizes for macOS
    rsvg-convert -w 128 -h 128 "$SVG_FILE" -o "$OUTPUT_DIR/icon-128.png"
    rsvg-convert -w 256 -h 256 "$SVG_FILE" -o "$OUTPUT_DIR/icon-256.png"
    rsvg-convert -w 512 -h 512 "$SVG_FILE" -o "$OUTPUT_DIR/icon-512.png"
    rsvg-convert -w 1024 -h 1024 "$SVG_FILE" -o "$OUTPUT_DIR/icon-1024.png"
    
    # Frontend favicon sizes
    rsvg-convert -w 16 -h 16 "$SVG_FILE" -o "$OUTPUT_DIR/favicon-16.png"
    rsvg-convert -w 32 -h 32 "$SVG_FILE" -o "$OUTPUT_DIR/favicon-32.png"
    rsvg-convert -w 48 -h 48 "$SVG_FILE" -o "$OUTPUT_DIR/favicon-48.png"
    rsvg-convert -w 96 -h 96 "$SVG_FILE" -o "$OUTPUT_DIR/favicon-96.png"
    rsvg-convert -w 192 -h 192 "$SVG_FILE" -o "$OUTPUT_DIR/favicon-192.png"
    
    echo "✅ PNG files generated in $OUTPUT_DIR"
    
    # Copy favicons to frontend public directory
    echo "📁 Copying favicons to frontend..."
    cp "$OUTPUT_DIR/favicon-16.png" "$FRONTEND_PUBLIC/"
    cp "$OUTPUT_DIR/favicon-32.png" "$FRONTEND_PUBLIC/"
    cp "$OUTPUT_DIR/favicon-48.png" "$FRONTEND_PUBLIC/"
    cp "$OUTPUT_DIR/favicon-96.png" "$FRONTEND_PUBLIC/"
    cp "$OUTPUT_DIR/favicon-192.png" "$FRONTEND_PUBLIC/"
    cp "$OUTPUT_DIR/icon-128.png" "$FRONTEND_PUBLIC/"
    cp "$OUTPUT_DIR/icon-256.png" "$FRONTEND_PUBLIC/"
    cp "$OUTPUT_DIR/icon-512.png" "$FRONTEND_PUBLIC/"
    # Copy SVG as well for high-quality rendering
    cp "$SVG_FILE" "$FRONTEND_PUBLIC/logo.svg"
    
    echo "✅ Favicons copied to $FRONTEND_PUBLIC"
else
    echo "⚠️  rsvg-convert not found. Install with: brew install librsvg"
    echo "   Alternatively, you can manually convert the SVG to PNG files"
    exit 1
fi

# Generate .icns file for macOS app (if iconutil is available)
if command -v iconutil >/dev/null 2>&1 && [ -f "$OUTPUT_DIR/icon-1024.png" ]; then
    echo "🍎 Generating macOS .icns file..."
    
    # Create iconset directory
    ICONSET_DIR="$OUTPUT_DIR/XXTCloudControl.iconset"
    mkdir -p "$ICONSET_DIR"
    
    # Copy PNG files to iconset with proper naming
    cp "$OUTPUT_DIR/icon-16.png" "$ICONSET_DIR/icon_16x16.png"
    cp "$OUTPUT_DIR/icon-32.png" "$ICONSET_DIR/icon_16x16@2x.png"
    cp "$OUTPUT_DIR/icon-32.png" "$ICONSET_DIR/icon_32x32.png"
    cp "$OUTPUT_DIR/icon-128.png" "$ICONSET_DIR/icon_32x32@2x.png"
    cp "$OUTPUT_DIR/icon-128.png" "$ICONSET_DIR/icon_128x128.png"
    cp "$OUTPUT_DIR/icon-256.png" "$ICONSET_DIR/icon_128x128@2x.png"
    cp "$OUTPUT_DIR/icon-256.png" "$ICONSET_DIR/icon_256x256.png"
    cp "$OUTPUT_DIR/icon-512.png" "$ICONSET_DIR/icon_256x256@2x.png"
    cp "$OUTPUT_DIR/icon-512.png" "$ICONSET_DIR/icon_512x512.png"
    cp "$OUTPUT_DIR/icon-1024.png" "$ICONSET_DIR/icon_512x512@2x.png"
    
    # Generate .icns file
    iconutil -c icns "$ICONSET_DIR" -o "$OUTPUT_DIR/XXTCloudControl.icns"
    
    # Clean up iconset directory
    rm -rf "$ICONSET_DIR"
    
    echo "✅ macOS .icns file generated: $OUTPUT_DIR/XXTCloudControl.icns"
else
    echo "⚠️  iconutil not available or PNG files missing"
fi

echo "🎉 Icon generation complete!"
echo "📁 Output directory: $OUTPUT_DIR"
echo "📁 Frontend public: $FRONTEND_PUBLIC"

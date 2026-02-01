#!/usr/bin/env bash

set -u
set -o pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$ROOT_DIR/server"
FRONTEND_DIR="$ROOT_DIR/frontend"
BUILD_DIR="$ROOT_DIR/build"
FRONTEND_OUT_DIR="$FRONTEND_DIR/dist"

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Error: required command '$1' not found." >&2
        exit 1
    fi
}

require_cmd go
require_cmd npm
require_cmd zip

# 支持的平台
platforms=(
    "linux/amd64"
    "linux/arm64"
    "windows/amd64"
    "windows/arm64"
    "darwin/amd64"
    "darwin/arm64"
)


# 获取构建信息
BUILD_TIME=$(date -u '+%Y%m%d%H%M')
VERSION="v$(date -u '+%Y%m%d%H%M%S')"
COMMIT=$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")

# 构建 ldflags
LDFLAGS="-X 'main.BuildTime=$BUILD_TIME' -X 'main.Version=$VERSION' -X 'main.Commit=$COMMIT'"

echo "Building XXTCloudControl frontend..."
if ! (cd "$FRONTEND_DIR" && npm run build); then
    echo "Error: frontend build failed." >&2
    exit 1
fi

if [ ! -d "$FRONTEND_OUT_DIR" ]; then
    echo "Error: frontend build output not found at $FRONTEND_OUT_DIR" >&2
    exit 1
fi

echo
echo "Building XXTCloudControl servers for multiple platforms..."
echo "Build Time: $BUILD_TIME"
echo "Version: $VERSION"
echo "Commit: $COMMIT"
echo

mkdir -p "$BUILD_DIR"

built_outputs=()

for platform in "${platforms[@]}"; do
    platform_split=(${platform//\// })
    GOOS=${platform_split[0]}
    GOARCH=${platform_split[1]}

    # WebSocket服务器
    websocket_output="xxtcloudserver-$GOOS-$GOARCH"
    if [ "$GOOS" = "windows" ]; then
        websocket_output+='.exe'
    fi

    echo "Building for $GOOS/$GOARCH..."

    # 编译WebSocket服务器（注入构建信息）
    echo "  - Building WebSocket server..."
    if (cd "$SERVER_DIR" && env GOOS=$GOOS GOARCH=$GOARCH go build -ldflags "$LDFLAGS" -o "$BUILD_DIR/$websocket_output" .); then
        echo "  Successfully built for $GOOS/$GOARCH"
        built_outputs+=("$BUILD_DIR/$websocket_output")
    else
        echo "  Failed to build for $GOOS/$GOARCH"
    fi
    echo
done

if [ "${#built_outputs[@]}" -eq 0 ]; then
    echo "Error: no backend builds succeeded; aborting package." >&2
    exit 1
fi

echo "Packaging frontend + backend..."
PACKAGE_DIR="$BUILD_DIR/.package"
PACKAGE_ROOT="$PACKAGE_DIR/XXTCloudControl"
ZIP_NAME="XXTCloudControl-$BUILD_TIME.zip"
ZIP_PATH="$BUILD_DIR/$ZIP_NAME"

rm -rf "$PACKAGE_DIR"
rm -f "$ZIP_PATH"
mkdir -p "$PACKAGE_ROOT/frontend"

cp -R "$FRONTEND_OUT_DIR"/. "$PACKAGE_ROOT/frontend/"
for output in "${built_outputs[@]}"; do
    cp "$output" "$PACKAGE_ROOT/"
done

(cd "$PACKAGE_DIR" && zip -r "$ZIP_PATH" "XXTCloudControl" >/dev/null)
rm -rf "$PACKAGE_DIR"

echo "Build completed!"
echo "Package: $ZIP_PATH"
echo "WebSocket servers:"
ls -la "$BUILD_DIR"/xxtcloudserver-*

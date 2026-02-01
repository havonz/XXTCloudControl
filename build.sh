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
require_cmd docker

if ! docker buildx version >/dev/null 2>&1; then
    echo "Error: docker buildx not available. Please enable Buildx." >&2
    exit 1
fi

ensure_buildx_builder() {
    local builder="${DOCKER_BUILDER_NAME:-xxtcloudcontrol}"
    local driver
    driver="$(docker buildx inspect 2>/dev/null | awk -F': ' '/Driver:/ {print $2; exit}')"
    if [ "$driver" = "docker" ]; then
        if ! docker buildx inspect "$builder" >/dev/null 2>&1; then
            if ! docker buildx create --name "$builder" --driver docker-container --use >/dev/null; then
                echo "Error: failed to create buildx builder '$builder'." >&2
                return 1
            fi
        else
            if ! docker buildx use "$builder" >/dev/null; then
                echo "Error: failed to use buildx builder '$builder'." >&2
                return 1
            fi
        fi
    fi
    if ! docker buildx inspect --bootstrap >/dev/null; then
        echo "Error: failed to bootstrap buildx builder." >&2
        return 1
    fi
}

# 支持的平台
platforms=(
    "linux/amd64"
    "linux/arm64"
    "windows/amd64"
    "windows/arm64"
    "darwin/amd64"
    "darwin/arm64"
)

docker_platforms=(
    "linux/amd64"
    "linux/arm64"
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

echo
echo "Building Docker images (x86_64 + aarch64)..."
DOCKER_IMAGE_NAME="${DOCKER_IMAGE_NAME:-xxtcloudcontrol}"
docker_outputs=()
if ! ensure_buildx_builder; then
    exit 1
fi

for platform in "${docker_platforms[@]}"; do
    IFS='/' read -r TARGETOS TARGETARCH <<< "$platform"
    OUTPUT_TAR="$BUILD_DIR/XXTCloudControl-docker-$BUILD_TIME-$TARGETOS-$TARGETARCH.tar"
    OUTPUT_TAR_TMP="${OUTPUT_TAR}.tmp"
    rm -f "$OUTPUT_TAR_TMP"
    IMAGE_TAG="$DOCKER_IMAGE_NAME:$VERSION-$TARGETARCH"

    echo "  - Building $platform -> $OUTPUT_TAR"
    if docker buildx build \
        --platform "$platform" \
        --build-arg BUILD_TIME="$BUILD_TIME" \
        --build-arg VERSION="$VERSION" \
        --build-arg COMMIT="$COMMIT" \
        -t "$IMAGE_TAG" \
        --output "type=docker,dest=$OUTPUT_TAR_TMP" \
        "$ROOT_DIR"; then
        if [ ! -s "$OUTPUT_TAR_TMP" ]; then
            echo "  Failed to export Docker image for $platform (empty tar)." >&2
            rm -f "$OUTPUT_TAR_TMP"
            exit 1
        fi
        mv "$OUTPUT_TAR_TMP" "$OUTPUT_TAR"
        docker_outputs+=("$OUTPUT_TAR")
    else
        echo "  Failed to build Docker image for $platform" >&2
        rm -f "$OUTPUT_TAR_TMP"
        exit 1
    fi
done

echo "Build completed!"
echo "Package: $ZIP_PATH"
echo "WebSocket servers:"
ls -la "$BUILD_DIR"/xxtcloudserver-*

if [ "${#docker_outputs[@]}" -gt 0 ]; then
    echo "Docker images:"
    ls -la "${docker_outputs[@]}"
fi

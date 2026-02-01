#!/usr/bin/env bash

set -u
set -o pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$ROOT_DIR/build"

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Error: required command '$1' not found." >&2
        exit 1
    fi
}

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

BUILD_TIME=$(date -u '+%Y%m%d%H%M')
VERSION="v$(date -u '+%Y%m%d%H%M%S')"
COMMIT=$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")

platforms=(
    "linux/amd64"
    "linux/arm64"
)

if ! ensure_buildx_builder; then
    exit 1
fi

mkdir -p "$BUILD_DIR"

echo "Building Docker images (x86_64 + aarch64)..."
DOCKER_IMAGE_NAME="${DOCKER_IMAGE_NAME:-xxtcloudcontrol}"
docker_outputs=()

for platform in "${platforms[@]}"; do
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

if [ "${#docker_outputs[@]}" -gt 0 ]; then
    echo "Docker images:"
    ls -la "${docker_outputs[@]}"
fi

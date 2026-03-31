import type { TouchPoint } from './multiTouchSession';

interface VideoDisplayArea {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export interface NormalizedVideoCoordinateOptions {
  clientX: number;
  clientY: number;
  videoElement: HTMLVideoElement;
  videoRect?: DOMRect;
  rotation?: number;
}

function getVideoDisplayArea(
  rect: DOMRect,
  videoWidth: number,
  videoHeight: number,
  rotation: number,
): VideoDisplayArea {
  const videoAspectRatio = videoWidth / videoHeight;
  const isSideways = rotation === 90 || rotation === 270;
  const displayAspectRatio = isSideways ? 1 / videoAspectRatio : videoAspectRatio;
  const containerAspectRatio = rect.width / rect.height;

  if (displayAspectRatio > containerAspectRatio) {
    return {
      width: rect.width,
      height: rect.width / displayAspectRatio,
      offsetX: 0,
      offsetY: (rect.height - (rect.width / displayAspectRatio)) / 2,
    };
  }

  return {
    width: rect.height * displayAspectRatio,
    height: rect.height,
    offsetX: (rect.width - (rect.height * displayAspectRatio)) / 2,
    offsetY: 0,
  };
}

function rotateCoordinates(point: TouchPoint, rotation: number): TouchPoint {
  switch (rotation) {
    case 90:
      return { x: point.y, y: 1 - point.x };
    case 180:
      return { x: 1 - point.x, y: 1 - point.y };
    case 270:
      return { x: 1 - point.y, y: point.x };
    default:
      return point;
  }
}

export function getNormalizedVideoCoordinates(options: NormalizedVideoCoordinateOptions): TouchPoint | null {
  const { clientX, clientY, videoElement, rotation = 0 } = options;
  const rect = options.videoRect ?? videoElement.getBoundingClientRect();
  const videoWidth = videoElement.videoWidth;
  const videoHeight = videoElement.videoHeight;

  if (!videoWidth || !videoHeight) {
    return null;
  }

  const displayArea = getVideoDisplayArea(rect, videoWidth, videoHeight, rotation);
  const clickPosX = clientX - rect.left;
  const clickPosY = clientY - rect.top;

  if (
    clickPosX < displayArea.offsetX ||
    clickPosX > displayArea.offsetX + displayArea.width ||
    clickPosY < displayArea.offsetY ||
    clickPosY > displayArea.offsetY + displayArea.height
  ) {
    return null;
  }

  const normalizedPoint = {
    x: (clickPosX - displayArea.offsetX) / displayArea.width,
    y: (clickPosY - displayArea.offsetY) / displayArea.height,
  };

  return rotateCoordinates(normalizedPoint, rotation);
}

export interface TouchPoint {
  x: number;
  y: number;
}

export interface TouchSessionSnapshot {
  fingerId: number;
  point: TouchPoint;
}

export interface MultiTouchSessionCallbacks {
  onTouchStart?: (session: TouchSessionSnapshot, localKey: string) => void;
  onTouchMove?: (session: TouchSessionSnapshot, localKey: string) => void;
  onTouchEnd?: (session: TouchSessionSnapshot, localKey: string) => void;
}

export interface MultiTouchSessionOptions {
  fingerIds?: number[];
  moveEpsilon?: number;
}

const DEFAULT_FINGER_IDS = Array.from({ length: 28 }, (_, index) => 28 - index);

function clonePoint(point: TouchPoint): TouchPoint {
  return { x: point.x, y: point.y };
}

function cloneSession(session: TouchSessionSnapshot): TouchSessionSnapshot {
  return {
    fingerId: session.fingerId,
    point: clonePoint(session.point)
  };
}

export class MultiTouchSessionManager {
  private readonly callbacks: MultiTouchSessionCallbacks;
  private readonly fingerIds: number[];
  private readonly moveEpsilon: number;
  private readonly activeTouches = new Map<string, TouchSessionSnapshot>();
  private readonly touchKeysByFingerId = new Map<number, string>();
  private readonly pendingMoves = new Map<number, TouchPoint>();
  private readonly lastSentMoveByFinger = new Map<number, TouchPoint>();
  private moveRafId: number | null = null;

  constructor(
    callbacks: MultiTouchSessionCallbacks = {},
    options: MultiTouchSessionOptions = {}
  ) {
    this.callbacks = callbacks;
    this.fingerIds = options.fingerIds?.length ? [...options.fingerIds] : [...DEFAULT_FINGER_IDS];
    this.moveEpsilon = options.moveEpsilon ?? 0.0015;
  }

  hasActiveTouches(): boolean {
    return this.activeTouches.size > 0;
  }

  getTouch(localKey: string): TouchSessionSnapshot | null {
    const session = this.activeTouches.get(localKey);
    return session ? cloneSession(session) : null;
  }

  beginTouch(localKey: string, point: TouchPoint): TouchSessionSnapshot | null {
    const existing = this.activeTouches.get(localKey);
    if (existing) {
      return cloneSession(existing);
    }

    const fingerId = this.allocateFingerId();
    if (fingerId === null) {
      return null;
    }

    const session = {
      fingerId,
      point: clonePoint(point)
    };

    this.activeTouches.set(localKey, session);
    this.touchKeysByFingerId.set(fingerId, localKey);
    this.pendingMoves.delete(fingerId);
    this.lastSentMoveByFinger.delete(fingerId);
    this.callbacks.onTouchStart?.(cloneSession(session), localKey);

    return cloneSession(session);
  }

  updateTouch(localKey: string, point: TouchPoint): TouchSessionSnapshot | null {
    const session = this.activeTouches.get(localKey);
    if (!session) {
      return null;
    }

    session.point = clonePoint(point);
    this.pendingMoves.set(session.fingerId, clonePoint(point));
    this.scheduleMoveFlush();
    return cloneSession(session);
  }

  endTouch(localKey: string, point?: TouchPoint): TouchSessionSnapshot | null {
    const session = this.activeTouches.get(localKey);
    if (!session) {
      return null;
    }

    if (point) {
      session.point = clonePoint(point);
    }

    this.flushPendingMoveForFinger(session.fingerId);

    const snapshot = cloneSession(session);
    this.activeTouches.delete(localKey);
    this.touchKeysByFingerId.delete(session.fingerId);
    this.pendingMoves.delete(session.fingerId);
    this.lastSentMoveByFinger.delete(session.fingerId);
    this.cancelMoveFlushIfIdle();
    this.callbacks.onTouchEnd?.(snapshot, localKey);

    return snapshot;
  }

  releaseAll(): TouchSessionSnapshot[] {
    if (!this.hasActiveTouches()) {
      this.reset();
      return [];
    }

    this.flushTouchMoves();

    const sessions = Array.from(this.activeTouches.entries()).map(([localKey, session]) => ({
      localKey,
      session: cloneSession(session)
    }));

    this.reset();

    for (const { localKey, session } of sessions) {
      this.callbacks.onTouchEnd?.(session, localKey);
    }

    return sessions.map(({ session }) => session);
  }

  reset(): void {
    if (this.moveRafId !== null) {
      cancelAnimationFrame(this.moveRafId);
      this.moveRafId = null;
    }
    this.activeTouches.clear();
    this.touchKeysByFingerId.clear();
    this.pendingMoves.clear();
    this.lastSentMoveByFinger.clear();
  }

  private allocateFingerId(): number | null {
    for (const fingerId of this.fingerIds) {
      if (!this.touchKeysByFingerId.has(fingerId)) {
        return fingerId;
      }
    }
    return null;
  }

  private scheduleMoveFlush(): void {
    if (this.moveRafId !== null) {
      return;
    }

    this.moveRafId = requestAnimationFrame(() => {
      this.moveRafId = null;
      this.flushTouchMoves();
    });
  }

  private cancelMoveFlushIfIdle(): void {
    if (this.pendingMoves.size === 0 && this.moveRafId !== null) {
      cancelAnimationFrame(this.moveRafId);
      this.moveRafId = null;
    }
  }

  private flushTouchMoves(): void {
    if (this.pendingMoves.size === 0) {
      return;
    }

    const queuedMoves = Array.from(this.pendingMoves.entries());
    this.pendingMoves.clear();

    for (const [fingerId, point] of queuedMoves) {
      this.flushPendingMoveForFinger(fingerId, point);
    }
  }

  private flushPendingMoveForFinger(fingerId: number, queuedPoint?: TouchPoint): void {
    const point = queuedPoint ?? this.pendingMoves.get(fingerId);
    if (!queuedPoint && point) {
      this.pendingMoves.delete(fingerId);
    }

    const localKey = this.touchKeysByFingerId.get(fingerId);
    if (!localKey || !point) {
      return;
    }

    const lastSentPoint = this.lastSentMoveByFinger.get(fingerId);
    if (lastSentPoint) {
      const dx = point.x - lastSentPoint.x;
      const dy = point.y - lastSentPoint.y;
      if ((dx * dx + dy * dy) < this.moveEpsilon * this.moveEpsilon) {
        return;
      }
    }

    const snapshot = {
      fingerId,
      point: clonePoint(point)
    };

    this.lastSentMoveByFinger.set(fingerId, clonePoint(point));
    this.callbacks.onTouchMove?.(snapshot, localKey);
  }
}

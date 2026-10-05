import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRemoteMouseMoveBatcher, getRemoteKeyFromCode } from '../remoteInput';

describe('remote input batching', () => {
  let frames: Map<number, FrameRequestCallback>;
  let requestFrame: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    frames = new Map();
    let nextFrame = 0;
    requestFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  });

  afterEach(() => vi.unstubAllGlobals());

  function advanceFrame() {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(0);
  }

  it('同一帧只发送最新坐标，并能继续调度下一帧', () => {
    const send = vi.fn();
    const batcher = createRemoteMouseMoveBatcher(send, 0.0015);
    batcher.schedule({ x: 0.1, y: 0.2 });
    batcher.schedule({ x: 0.2, y: 0.3 });
    batcher.schedule({ x: 0.3, y: 0.4 });
    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    advanceFrame();
    expect(send.mock.calls).toEqual([[{ x: 0.3, y: 0.4 }]]);
    batcher.schedule({ x: 0.4, y: 0.5 });
    advanceFrame();
    expect(send).toHaveBeenLastCalledWith({ x: 0.4, y: 0.5 });
    expect(frames.size).toBe(0);
  });

  it('细小移动累计到阈值仍会发送，重复位置不会重复发送', () => {
    const send = vi.fn();
    const batcher = createRemoteMouseMoveBatcher(send, 0.0015);
    for (const x of [0, 0.0005, 0.001, 0.0015, 0.0015]) {
      batcher.schedule({ x, y: 0 });
      advanceFrame();
    }
    expect(send.mock.calls).toEqual([[{ x: 0, y: 0 }], [{ x: 0.0015, y: 0 }]]);
  });

  it('释放前立即补发末尾坐标，取消的帧不再重复发送', () => {
    const events: string[] = [];
    const batcher = createRemoteMouseMoveBatcher(point => events.push(`move:${point.x}`), 0.0015);
    batcher.schedule({ x: 0.2, y: 0.2 });
    batcher.schedule({ x: 0.6, y: 0.6 });
    batcher.flush();
    events.push('up');
    advanceFrame();
    batcher.flush();
    expect(events).toEqual(['move:0.6', 'up']);
    expect(frames.size).toBe(0);
  });

  it('清理只取消当前实例，并让下一次拖动重新发送首个坐标', () => {
    const firstSend = vi.fn();
    const secondSend = vi.fn();
    const first = createRemoteMouseMoveBatcher(firstSend, 0.0015);
    const second = createRemoteMouseMoveBatcher(secondSend, 0.0015);
    first.schedule({ x: 0.5, y: 0.5 });
    advanceFrame();
    firstSend.mockClear();
    first.schedule({ x: 0.7, y: 0.7 });
    second.schedule({ x: 0.7, y: 0.7 });
    first.clear();
    advanceFrame();
    expect(firstSend).not.toHaveBeenCalled();
    expect(secondSend).toHaveBeenCalledWith({ x: 0.7, y: 0.7 });
    first.schedule({ x: 0.5, y: 0.5 });
    advanceFrame();
    expect(firstSend).toHaveBeenCalledWith({ x: 0.5, y: 0.5 });
  });

  it('未支持的物理键不会变成设备按键', () => {
    for (const code of ['', 'Unidentified', 'Numpad1', 'F13', 'Process', 'constructor']) {
      expect(getRemoteKeyFromCode(code)).toBeNull();
    }
  });
});

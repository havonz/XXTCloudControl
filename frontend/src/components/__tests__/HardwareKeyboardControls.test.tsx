// @vitest-environment happy-dom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import type { Device } from '../../services/AuthService';
import type { WebSocketService } from '../../services/WebSocketService';
import BatchRemoteControl from '../BatchRemoteControl';
import WebRTCControl from '../WebRTCControl';

const webRTCMockState = vi.hoisted(() => ({
  instances: [] as Array<{
    udid: string;
    events: Record<string, (...args: any[]) => void>;
    sendKeyCommand: ReturnType<typeof vi.fn>;
    sendHardwareKeyboardCommand: ReturnType<typeof vi.fn>;
    stopStream: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('../../services/WebRTCService', () => ({
  WebRTCService: class {
    udid: string;
    events: Record<string, (...args: any[]) => void>;
    sendKeyCommand = vi.fn();
    sendHardwareKeyboardCommand = vi.fn();
    sendTouchCommand = vi.fn();
    sendWheelCommand = vi.fn();
    sendPasteCommand = vi.fn();
    sendClipboardCommand = vi.fn();
    setFrameRate = vi.fn(async () => {});
    setResolution = vi.fn(async () => {});
    startStream = vi.fn(async () => {
      this.events.onConnected?.();
      this.events.onDataChannelOpen?.();
    });
    stopStream = vi.fn(async () => {
      this.events.onDisconnected?.();
    });
    cleanup = vi.fn(async () => {});
    getPeerConnection = vi.fn(() => null);

    constructor(
      _webSocketService: unknown,
      udid: string,
      _password: string,
      events: Record<string, (...args: any[]) => void>
    ) {
      this.udid = udid;
      this.events = events;
      webRTCMockState.instances.push(this);
    }
  },
}));

class WebSocketServiceMock {
  listeners = new Set<(message: any) => void>();
  sendGlobalHardwareKeyboardCommand = vi.fn<(
    udids: string[],
    action: 'status' | 'connect' | 'disconnect',
    owner: string
  ) => Promise<boolean>>(async () => true);
  keyDownMultiple = vi.fn<(udids: string[], key: string) => Promise<boolean>>(async () => true);
  keyUpMultiple = vi.fn<(udids: string[], key: string) => Promise<boolean>>(async () => true);
  pressKeyMultiple = vi.fn<(udids: string[], key: string) => Promise<boolean>>(async () => true);
  touchDownMultipleNormalized = vi.fn();
  touchMoveMultipleNormalized = vi.fn();
  touchUpMultipleNormalized = vi.fn();
  sendWheelCommandMultipleNormalized = vi.fn();
  writeClipboard = vi.fn();

  onMessage(listener: (message: any) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(message: any) {
    for (const listener of this.listeners) {
      listener(message);
    }
  }
}

class IntersectionObserverMock {
  static instances: IntersectionObserverMock[] = [];
  readonly targets = new Set<Element>();

  constructor(
    private readonly callback: IntersectionObserverCallback,
    _options?: IntersectionObserverInit
  ) {
    IntersectionObserverMock.instances.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
  }

  emit(target: Element, isIntersecting: boolean) {
    this.callback([
      {
        target,
        isIntersecting,
        intersectionRatio: isIntersecting ? 1 : 0,
      } as IntersectionObserverEntry,
    ], this as unknown as IntersectionObserver);
  }

  takeRecords() {
    return [];
  }

  root = null;
  rootMargin = '0px';
  thresholds = [0];
}

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const flush = (delay = 0) => new Promise(resolve => setTimeout(resolve, delay));

function device(udid: string, capable: boolean): Device {
  return {
    udid,
    system: {
      name: udid,
      scrw: 1170,
      scrh: 2532,
    },
    ...(capable
      ? {
          cloudControl: {
            protocolVersion: 2,
            features: { globalHardwareKeyboard: true },
          },
        }
      : {}),
  };
}

function clickButton(text: string) {
  const button = [...document.querySelectorAll('button')]
    .find(candidate => candidate.textContent?.trim() === text);
  expect(button, `button ${text}`).toBeTruthy();
  button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return button as HTMLButtonElement;
}

function selectAllDevices() {
  const label = [...document.querySelectorAll('label')]
    .find(candidate => candidate.textContent?.includes('全选同步操作'));
  const checkbox = label?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
  expect(checkbox).toBeTruthy();
  checkbox!.checked = true;
  checkbox!.dispatchEvent(new Event('change', { bubbles: true }));
}

function clearAllDevices() {
  const label = [...document.querySelectorAll('label')]
    .find(candidate => candidate.textContent?.includes('全选同步操作'));
  const checkbox = label?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
  expect(checkbox).toBeTruthy();
  checkbox!.checked = false;
  checkbox!.dispatchEvent(new Event('change', { bubbles: true }));
}

function emitKeyboardState(
  ws: WebSocketServiceMock,
  udid: string,
  owner: string,
  action: 'status' | 'connect' | 'disconnect',
  connected: boolean,
  ok = true
) {
  ws.emit({
    type: 'key/global-keyboard',
    udid,
    body: {
      action,
      owner,
      supported: true,
      ok,
      connected,
    },
  });
}

function mountBatch(devices: Device[] | (() => Device[]), ws: WebSocketServiceMock) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => (
    <I18nProvider defaultLocale="zh-CN">
      <BatchRemoteControl
        isOpen
        onClose={() => {}}
        devices={typeof devices === 'function' ? devices() : devices}
        webSocketService={ws as unknown as WebSocketService}
        password=""
      />
    </I18nProvider>
  ), host);
  return {
    dispose: () => {
      dispose();
      host.remove();
    },
  };
}

describe('硬件键盘实时控制', () => {
  beforeEach(() => {
    webRTCMockState.instances.length = 0;
    IntersectionObserverMock.instances.length = 0;
    const storedValues = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storedValues.get(key) ?? null,
      setItem: (key: string, value: string) => storedValues.set(key, String(value)),
      removeItem: (key: string) => storedValues.delete(key),
      clear: () => storedValues.clear(),
      key: (index: number) => [...storedValues.keys()][index] ?? null,
      get length() {
        return storedValues.size;
      },
    });
    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0)
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('单控同步目标在按下后移除时向原目标补发 key up', async () => {
    const ws = new WebSocketServiceMock();
    const [devices, setDevices] = createSignal([device('current', false), device('mirror', false)]);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => (
      <I18nProvider defaultLocale="zh-CN">
        <WebRTCControl
          isOpen
          onClose={() => {}}
          selectedDevices={devices}
          webSocketService={ws as unknown as WebSocketService}
          password=""
        />
      </I18nProvider>
    ), host);

    await flush();
    clickButton('同步');
    clickButton('连接');
    await flush();

    window.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'KeyA',
      key: 'a',
      bubbles: true,
    }));
    expect(ws.keyDownMultiple).toHaveBeenCalledWith(['mirror'], 'A');

    setDevices([device('current', false)]);
    await flush();
    expect(ws.keyUpMultiple).toHaveBeenCalledWith(['mirror'], 'A');

    dispose();
    host.remove();
  });

  it('批控混合设备只查询 capability 明确支持的设备', async () => {
    const ws = new WebSocketServiceMock();
    const mounted = mountBatch([
      device('supported', true),
      device('legacy', false),
    ], ws);

    await flush();
    selectAllDevices();
    await flush();

    expect(ws.sendGlobalHardwareKeyboardCommand).toHaveBeenCalledTimes(1);
    expect(ws.sendGlobalHardwareKeyboardCommand.mock.calls[0][0]).toEqual(['supported']);
    expect(ws.sendGlobalHardwareKeyboardCommand.mock.calls[0][1]).toBe('status');

    mounted.dispose();
  });

  it('批控在两个方向迁移时都等待旧后端确认断开', async () => {
    const ws = new WebSocketServiceMock();
    const mounted = mountBatch([device('device-1', true)], ws);

    await flush();
    selectAllDevices();
    await flush();
    const owner = ws.sendGlobalHardwareKeyboardCommand.mock.calls[0][2] as string;
    emitKeyboardState(ws, 'device-1', owner, 'status', false);
    await flush();
    clickButton('连接键盘');
    await flush();
    emitKeyboardState(ws, 'device-1', owner, 'connect', true);
    await flush();

    clickButton('连接');
    await flush();
    const service = webRTCMockState.instances[0];
    expect(service).toBeTruthy();
    expect(ws.sendGlobalHardwareKeyboardCommand.mock.calls.at(-1)?.[1]).toBe('disconnect');
    expect(service.sendHardwareKeyboardCommand).not.toHaveBeenCalled();

    emitKeyboardState(ws, 'device-1', owner, 'disconnect', false);
    await flush();
    expect(service.sendHardwareKeyboardCommand).toHaveBeenCalledWith('connect');
    service.events.onHardwareKeyboardState?.({
      action: 'connect',
      supported: true,
      ok: true,
      connected: true,
    });
    await flush();

    await flush(120);
    const card = document.querySelector('[data-udid="device-1"]');
    const observer = IntersectionObserverMock.instances.at(-1);
    expect(card).toBeTruthy();
    expect(observer).toBeTruthy();
    observer!.emit(card!, true);
    observer!.emit(card!, false);
    await flush();
    expect(service.sendHardwareKeyboardCommand).toHaveBeenCalledWith('disconnect');
    const wsConnectCountBeforeConfirmation = ws.sendGlobalHardwareKeyboardCommand.mock.calls
      .filter(call => call[1] === 'connect').length;
    expect(wsConnectCountBeforeConfirmation).toBe(1);

    service.events.onHardwareKeyboardState?.({
      action: 'disconnect',
      supported: true,
      ok: true,
      connected: false,
    });
    await flush();
    const wsConnectCountAfterConfirmation = ws.sendGlobalHardwareKeyboardCommand.mock.calls
      .filter(call => call[1] === 'connect').length;
    expect(wsConnectCountAfterConfirmation).toBe(2);

    mounted.dispose();
  });

  it('WS 迁移断开失败时不连接新后端并解除 pending', async () => {
    const ws = new WebSocketServiceMock();
    const mounted = mountBatch([device('device-1', true)], ws);

    await flush();
    selectAllDevices();
    await flush();
    const owner = ws.sendGlobalHardwareKeyboardCommand.mock.calls[0][2] as string;
    emitKeyboardState(ws, 'device-1', owner, 'status', false);
    await flush();
    clickButton('连接键盘');
    await flush();
    emitKeyboardState(ws, 'device-1', owner, 'connect', true);
    await flush();
    clickButton('连接');
    await flush();

    const service = webRTCMockState.instances[0];
    emitKeyboardState(ws, 'device-1', owner, 'disconnect', true, false);
    await flush();
    expect(service.sendHardwareKeyboardCommand).not.toHaveBeenCalled();
    const disconnectButton = [...document.querySelectorAll('button')]
      .find(candidate => candidate.textContent?.trim() === '断开键盘') as HTMLButtonElement | undefined;
    expect(disconnectButton).toBeTruthy();
    expect(disconnectButton!.disabled).toBe(false);

    window.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'KeyA',
      key: 'a',
      bubbles: true,
    }));
    expect(ws.keyDownMultiple).toHaveBeenCalledWith(['device-1'], 'A');
    expect(service.sendKeyCommand).not.toHaveBeenCalled();

    mounted.dispose();
  });

  it('目标取消后 disconnect 失败不会驱动无限清理重发', async () => {
    const ws = new WebSocketServiceMock();
    const mounted = mountBatch([device('device-1', true)], ws);

    await flush();
    selectAllDevices();
    await flush();
    const owner = ws.sendGlobalHardwareKeyboardCommand.mock.calls[0][2];
    emitKeyboardState(ws, 'device-1', owner, 'status', false);
    await flush();
    clickButton('连接键盘');
    await flush();
    emitKeyboardState(ws, 'device-1', owner, 'connect', true);
    await flush();

    clearAllDevices();
    await flush();
    const disconnectCount = ws.sendGlobalHardwareKeyboardCommand.mock.calls
      .filter(call => call[1] === 'disconnect').length;
    expect(disconnectCount).toBe(1);

    emitKeyboardState(ws, 'device-1', owner, 'disconnect', true, false);
    await flush();
    expect(ws.sendGlobalHardwareKeyboardCommand.mock.calls
      .filter(call => call[1] === 'disconnect')).toHaveLength(disconnectCount);

    mounted.dispose();
    await flush();
    expect(ws.sendGlobalHardwareKeyboardCommand.mock.calls
      .filter(call => call[1] === 'disconnect')).toHaveLength(disconnectCount + 1);
  });

  it('设备重连状态响应会清除丢失 disconnect 留下的 transient 状态', async () => {
    const ws = new WebSocketServiceMock();
    const [devices, setDevices] = createSignal([device('device-1', true)]);
    const mounted = mountBatch(devices, ws);

    await flush();
    selectAllDevices();
    await flush();
    const owner = ws.sendGlobalHardwareKeyboardCommand.mock.calls[0][2];
    emitKeyboardState(ws, 'device-1', owner, 'status', false);
    await flush();
    clickButton('连接键盘');
    await flush();
    emitKeyboardState(ws, 'device-1', owner, 'connect', true);
    await flush();

    clearAllDevices();
    await flush();
    expect(ws.sendGlobalHardwareKeyboardCommand.mock.calls
      .filter(call => call[1] === 'disconnect')).toHaveLength(1);

    setDevices([]);
    await flush();
    setDevices([device('device-1', true)]);
    await flush();
    selectAllDevices();
    await flush();
    expect(ws.sendGlobalHardwareKeyboardCommand.mock.calls.at(-1)?.[1]).toBe('status');
    emitKeyboardState(ws, 'device-1', owner, 'status', false);
    await flush();
    clickButton('连接键盘');
    await flush();
    emitKeyboardState(ws, 'device-1', owner, 'connect', true);
    await flush();
    clearAllDevices();
    await flush();

    expect(ws.sendGlobalHardwareKeyboardCommand.mock.calls
      .filter(call => call[1] === 'disconnect')).toHaveLength(2);

    mounted.dispose();
  });

  it('快速取消并切到 WebRTC 后仍等待原 WS 路由断开', async () => {
    const ws = new WebSocketServiceMock();
    const mounted = mountBatch([device('device-1', true)], ws);

    await flush();
    selectAllDevices();
    await flush();
    const owner = ws.sendGlobalHardwareKeyboardCommand.mock.calls[0][2];
    emitKeyboardState(ws, 'device-1', owner, 'status', false);
    await flush();
    clickButton('连接键盘');
    await flush();
    emitKeyboardState(ws, 'device-1', owner, 'connect', true);
    await flush();

    clearAllDevices();
    await flush();
    clickButton('连接');
    await flush();
    selectAllDevices();
    await flush();

    const service = webRTCMockState.instances[0];
    expect(service).toBeTruthy();
    expect(service.sendHardwareKeyboardCommand).not.toHaveBeenCalled();

    emitKeyboardState(ws, 'device-1', owner, 'disconnect', false);
    await flush();
    expect(service.sendHardwareKeyboardCommand).toHaveBeenCalledWith('status');

    mounted.dispose();
  });
});

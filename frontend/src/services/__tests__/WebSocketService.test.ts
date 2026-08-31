import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  WebSocketService,
  supportsGlobalHardwareKeyboard,
  type Device,
} from '../WebSocketService';
import { translate } from '../../i18n';
import { resolveDeviceSystemMessage } from '../../utils/deviceMessage';

function setWindow(): void {
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
  });
}

function seedDevices(service: WebSocketService, devices: Device[]): void {
  const target = service as any;
  target.devices = devices;
  target.deviceIndexByUdid = new Map(devices.map((device, index) => [device.udid, index]));
}

function collectUpdates(service: WebSocketService): Device[][] {
  const updates: Device[][] = [];
  service.onDeviceUpdate((devices) => {
    updates.push(devices);
  });
  return updates;
}

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  close(code = 1000, reason = '') {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }

    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  send(message: string) {
    this.sent.push(message);
  }
}

describe('WebSocketService script message updates', () => {
  beforeAll(() => {
    setWindow();
    Object.defineProperty(globalThis, 'WebSocket', {
      value: FakeWebSocket,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      configurable: true,
    });
  });

  afterAll(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).WebSocket;
    delete (globalThis as any).localStorage;
  });

  afterEach(() => {
    FakeWebSocket.instances = [];
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('script/run 只更新 system 状态，不替换已有 script 引用', () => {
    vi.useFakeTimers();

    const service = new WebSocketService('ws://127.0.0.1:46980');
    const script = { select: 'a.lua', running: false };
    const device: Device = {
      udid: 'device-1',
      script,
      system: { running: false, paused: true },
    };
    seedDevices(service, [device]);
    const updates = collectUpdates(service);

    (service as any).handleMessage({
      type: 'script/run',
      udid: 'device-1',
      body: { name: 'a.lua' },
    });

    vi.runAllTimers();

    const nextDevice = (service as any).devices[0] as Device;
    expect(nextDevice.system?.running).toBe(true);
    expect(nextDevice.system?.paused).toBe(false);
    expect(nextDevice.script).toBe(script);
    expect(updates).toHaveLength(1);
    expect(updates[0][0].script).toBe(script);
  });

  it('script/stop 在缺少 script 时仍会补空对象并更新状态', () => {
    vi.useFakeTimers();

    const service = new WebSocketService('ws://127.0.0.1:46980');
    const device: Device = {
      udid: 'device-2',
      system: { running: true, paused: true },
    };
    seedDevices(service, [device]);
    const updates = collectUpdates(service);

    (service as any).handleMessage({
      type: 'script/stop',
      udid: 'device-2',
    });

    vi.runAllTimers();

    const nextDevice = (service as any).devices[0] as Device;
    expect(nextDevice.system?.running).toBe(false);
    expect(nextDevice.system?.paused).toBe(false);
    expect(nextDevice.script).toEqual({});
    expect(updates).toHaveLength(1);
    expect(updates[0][0].script).toEqual({});
  });

  it('script/selected/put 仅同步 tempOldSelect 时保留 script 引用', () => {
    vi.useFakeTimers();

    const service = new WebSocketService('ws://127.0.0.1:46980');
    const script = { select: 'keep.lua', running: false };
    const device: Device = {
      udid: 'device-3',
      script,
      tempOldSelect: '',
      system: { running: false, paused: false },
    };
    seedDevices(service, [device]);
    const updates = collectUpdates(service);

    (service as any).handleMessage({
      type: 'script/selected/put',
      udid: 'device-3',
      body: { name: 'keep.lua' },
    });

    vi.runAllTimers();

    const nextDevice = (service as any).devices[0] as Device;
    expect(nextDevice.tempOldSelect).toBe('keep.lua');
    expect(nextDevice.script).toBe(script);
    expect(updates).toHaveLength(1);
    expect(updates[0][0].script).toBe(script);
  });

  it('script/selected/put 在脚本变化时更新 select 并替换 script 引用', () => {
    vi.useFakeTimers();

    const service = new WebSocketService('ws://127.0.0.1:46980');
    const script = { select: 'old.lua', running: false };
    const device: Device = {
      udid: 'device-4',
      script,
      tempOldSelect: 'old.lua',
      system: { running: false, paused: false },
    };
    seedDevices(service, [device]);
    const updates = collectUpdates(service);

    (service as any).handleMessage({
      type: 'script/selected/put',
      udid: 'device-4',
      body: { name: 'new.lua' },
    });

    vi.runAllTimers();

    const nextDevice = (service as any).devices[0] as Device;
    expect(nextDevice.tempOldSelect).toBe('new.lua');
    expect(nextDevice.script?.select).toBe('new.lua');
    expect(nextDevice.script).not.toBe(script);
    expect(nextDevice.script?.running).toBe(false);
    expect(updates).toHaveLength(1);
    expect(updates[0][0].script?.select).toBe('new.lua');
  });

  it('设备语义消息只接收一次也能随界面语言重新翻译', () => {
    vi.useFakeTimers();

    const service = new WebSocketService('ws://127.0.0.1:46980');
    seedDevices(service, [{ udid: 'device-message', system: {} }]);

    (service as any).handleMessage({
      type: 'device/message',
      body: {
        udid: 'device-message',
        message: '上传脚本（3 个小文件，2 个大文件）',
        messageCode: 'device.script.upload_summary',
        messageParams: { small: 3, large: 2 },
      },
    });
    vi.runAllTimers();

    const device = (service as any).devices[0] as Device;
    expect(device.system).toMatchObject({
      messageCode: 'device.script.upload_summary',
      messageParams: { small: 3, large: 2 },
    });
    expect(resolveDeviceSystemMessage(device.system, (key, vars) => translate('zh-CN', key, vars)))
      .toBe('上传脚本（3 个小文件，2 个大文件）');
    expect(resolveDeviceSystemMessage(device.system, (key, vars) => translate('en-US', key, vars)))
      .toBe('Upload script (3 small files, 2 large files)');
  });

  it('传输进度保存消息键和参数，不预先翻译', () => {
    vi.useFakeTimers();

    const service = new WebSocketService('ws://127.0.0.1:46980');
    seedDevices(service, [{ udid: 'device-transfer', system: { message: 'old' } }]);

    (service as any).handleMessage({
      type: 'transfer/progress',
      body: { deviceSN: 'device-transfer', percent: 42.4 },
    });
    vi.runAllTimers();

    expect((service as any).devices[0].system).toEqual({
      messageCode: 'websocket.transfer_progress',
      messageParams: { percent: '42' },
    });
  });

  it('认证成功后清理认证超时定时器', () => {
    vi.useFakeTimers();

    const authResults: Array<{ success: boolean; error?: string }> = [];
    const service = new WebSocketService('ws://127.0.0.1:46980/api/ws', 'password');
    service.onAuthResult((success, error) => {
      authResults.push({ success, error });
    });

    service.connect();
    FakeWebSocket.instances[0].open();

    expect(vi.getTimerCount()).toBe(1);

    (service as any).handleMessage({
      type: 'control/devices',
      body: {},
    });

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);

    expect(authResults).toEqual([{ success: true, error: undefined }]);
  });

  it('认证期间断开连接会清理认证超时定时器', () => {
    vi.useFakeTimers();

    const authResults: Array<{ success: boolean; error?: string }> = [];
    const service = new WebSocketService('ws://127.0.0.1:46980/api/ws', 'password');
    service.onAuthResult((success, error) => {
      authResults.push({ success, error });
    });

    service.connect();
    FakeWebSocket.instances[0].open();
    service.disconnect();

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);

    expect(authResults).toEqual([]);
  });

  it('认证失败会返回结构化失败类型和稳定错误码', () => {
    vi.useFakeTimers();

    const authResults: Array<{
      success: boolean;
      error?: string;
      failure?: { kind: string; code: string };
    }> = [];
    const service = new WebSocketService('ws://127.0.0.1:46980/api/ws', 'password');
    service.onAuthResult((success, error, failure) => {
      authResults.push({ success, error, failure });
    });

    service.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.close(1006, 'rejected');

    expect(authResults).toEqual([{
      success: false,
      error: 'Authentication failed. Log in again.',
      failure: {
        kind: 'authentication',
        code: 'websocket.auth_failed_login_again',
      },
    }]);
  });

  it('WebSocket 断线时立即 reject pending request', async () => {
    vi.useFakeTimers();

    const service = new WebSocketService('ws://127.0.0.1:46980/api/ws', 'password');
    service.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();

    (service as any).handleMessage({
      type: 'control/devices',
      body: {},
    });

    const request = service.sendCommandAsync(['device-1'], 'file/list', { path: '/' }, 10000);
    expect((service as any).pendingRequestsById.size).toBe(1);

    (service as any).shouldReconnect = false;
    socket.close(1006, 'lost');

    await expect(request).rejects.toThrow('WebSocket disconnected');
    expect((service as any).pendingRequestsById.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('触控命令按 finger 附加单调递增 touchTs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-28T00:00:00.000Z'));

    const service = new WebSocketService('ws://127.0.0.1:46980/api/ws', 'password');
    service.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.sent = [];

    await service.touchDown('device-1', 10, 20, 1);
    await service.touchMove('device-1', 11, 21, 1);

    const first = JSON.parse(socket.sent[0]);
    const second = JSON.parse(socket.sent[1]);
    const firstBody = first.body.body;
    const secondBody = second.body.body;

    expect(firstBody).toMatchObject({ x: 10, y: 20, finger: 1 });
    expect(secondBody).toMatchObject({ x: 11, y: 21, finger: 1 });
    expect(firstBody.touchTs).toBe(Date.now());
    expect(secondBody.touchTs).toBe(Date.now() + 1);
  });

  it('硬件键盘命令只发送 action 和 owner', async () => {
    vi.useFakeTimers();

    const service = new WebSocketService('ws://127.0.0.1:46980/api/ws', 'password');
    service.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.sent = [];

    await service.sendGlobalHardwareKeyboardCommand(['device-1'], 'connect', 'owner-1');

    const message = JSON.parse(socket.sent[0]);
    expect(message.body).toMatchObject({
      devices: ['device-1'],
      type: 'key/global-keyboard',
      body: {
        action: 'connect',
        owner: 'owner-1',
      },
    });
    expect(Object.keys(message.body.body).sort()).toEqual(['action', 'owner']);
  });

  it('设备未明确声明 capability 时视为不支持', () => {
    vi.useFakeTimers();
    expect(supportsGlobalHardwareKeyboard({ udid: 'old-device' })).toBe(false);
    expect(supportsGlobalHardwareKeyboard({
      udid: 'new-device',
      cloudControl: {
        protocolVersion: 2,
        features: {
          globalHardwareKeyboard: true,
        },
      },
    })).toBe(true);
  });

  it('更新设备名称时保留其他字段和未修改设备引用', () => {
    vi.useFakeTimers();

    const service = new WebSocketService('ws://127.0.0.1:46980');
    const system = { name: '旧名称', running: false, battery: 80 };
    const script = { select: 'keep.lua', running: false };
    const renamedDevice: Device = {
      udid: 'device-1',
      system,
      script,
      group: 'group-1',
    };
    const untouchedDevice: Device = {
      udid: 'device-2',
      system: { name: '保持名称' },
    };
    seedDevices(service, [renamedDevice, untouchedDevice]);
    const updates = collectUpdates(service);

    service.updateDeviceName('device-1', '新名称');
    vi.runAllTimers();

    const devices = service.getDevices();
    expect(devices[0]).not.toBe(renamedDevice);
    expect(devices[0].system).not.toBe(system);
    expect(devices[0].system).toEqual({
      name: '新名称',
      running: false,
      battery: 80,
    });
    expect(devices[0].script).toBe(script);
    expect(devices[0].group).toBe('group-1');
    expect(devices[1]).toBe(untouchedDevice);
    expect(updates).toHaveLength(1);
    expect(updates[0][0]).toBe(devices[0]);
    expect(updates[0][1]).toBe(untouchedDevice);
  });
});

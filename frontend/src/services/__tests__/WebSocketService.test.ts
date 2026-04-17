import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocketService, type Device } from '../WebSocketService';

const setWindow = () => {
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
  });
};

const seedDevices = (service: WebSocketService, devices: Device[]) => {
  const target = service as any;
  target.devices = devices;
  target.deviceIndexByUdid = new Map(devices.map((device, index) => [device.udid, index]));
};

const collectUpdates = (service: WebSocketService) => {
  const updates: Device[][] = [];
  service.onDeviceUpdate((devices) => {
    updates.push(devices);
  });
  return updates;
};

describe('WebSocketService script message updates', () => {
  beforeAll(() => {
    setWindow();
  });

  afterAll(() => {
    delete (globalThis as any).window;
  });

  afterEach(() => {
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
});

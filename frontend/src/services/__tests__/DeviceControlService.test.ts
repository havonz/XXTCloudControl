import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DeviceControlService } from '../DeviceControlService';
import type { WebSocketService } from '../WebSocketService';

function setWindow(): void {
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
  });
}

function encodeJsonBody(value: any): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))));
}

function decodeJsonBody(value: string): any {
  return JSON.parse(decodeURIComponent(escape(atob(value))));
}

function createWebSocketService(): {
  listeners: Array<(message: any) => void>;
  statusListeners: Array<(status: 'connecting' | 'connected' | 'disconnected') => void>;
  sentMessages: any[];
  wsService: WebSocketService;
} {
  const listeners: Array<(message: any) => void> = [];
  const statusListeners: Array<(status: 'connecting' | 'connected' | 'disconnected') => void> = [];
  const sentMessages: any[] = [];
  const wsService = {
    onMessage: vi.fn((callback: (message: any) => void) => {
      listeners.push(callback);
      return () => {
        const index = listeners.indexOf(callback);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      };
    }),
    onStatusChange: vi.fn((callback: (status: 'connecting' | 'connected' | 'disconnected') => void) => {
      statusListeners.push(callback);
      return () => {
        const index = statusListeners.indexOf(callback);
        if (index >= 0) {
          statusListeners.splice(index, 1);
        }
      };
    }),
    send: vi.fn((message: any) => {
      sentMessages.push(message);
      return true;
    }),
  } as unknown as WebSocketService;

  return { listeners, statusListeners, sentMessages, wsService };
}

describe('DeviceControlService control/http requests', () => {
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

  it('解析 control/http 成功响应并保持 DeviceControlResult 结构', async () => {
    vi.useFakeTimers();

    const { listeners, sentMessages, wsService } = createWebSocketService();
    const service = new DeviceControlService(wsService, 'password');
    const request = service.lockScreen(['device-1']);

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].type).toBe('control/http');
    expect(sentMessages[0].body.path).toBe('/lock_screen');

    listeners[0]({
      type: 'http/response',
      body: {
        requestId: sentMessages[0].body.requestId,
        statusCode: 200,
        body: encodeJsonBody({ ok: true }),
      },
    });

    await expect(request).resolves.toEqual({
      success: true,
      detail: { ok: true },
    });

    service.destroy();
  });

  it('请求超时仍 resolve 为失败结果', async () => {
    vi.useFakeTimers();

    const { wsService } = createWebSocketService();
    const service = new DeviceControlService(wsService, 'password');
    const request = service.setVolume(['device-1'], 50);

    vi.advanceTimersByTime(15000);

    await expect(request).resolves.toEqual({
      success: false,
      error: 'Request timeout',
    });

    service.destroy();
  });

  it('WebSocket 断开时立即结束待处理请求', async () => {
    vi.useFakeTimers();

    const { statusListeners, wsService } = createWebSocketService();
    const service = new DeviceControlService(wsService, 'password');
    const request = service.unlockScreen(['device-1']);

    statusListeners[0]('disconnected');

    await expect(request).resolves.toEqual({
      success: false,
      error: 'WebSocket连接已断开',
    });
    expect(vi.getTimerCount()).toBe(0);

    service.destroy();
  });

  it('获取单台设备信息并严格校验设备响应', async () => {
    vi.useFakeTimers();

    const { listeners, sentMessages, wsService } = createWebSocketService();
    const service = new DeviceControlService(wsService, 'password');
    const request = service.getDeviceInfo('device-1');

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].body).toMatchObject({
      devices: ['device-1'],
      method: 'GET',
      path: '/deviceinfo',
    });

    listeners[0]({
      type: 'http/response',
      body: {
        requestId: sentMessages[0].body.requestId,
        statusCode: 200,
        body: encodeJsonBody({
          code: 0,
          message: '操作成功',
          data: { devtype: 'iPhone17,1' },
        }),
      },
    });

    await expect(request).resolves.toEqual({
      success: true,
      data: { devtype: 'iPhone17,1' },
    });

    const failedRequest = service.getDeviceInfo('device-2');
    listeners[0]({
      type: 'http/response',
      body: {
        requestId: sentMessages[1].body.requestId,
        statusCode: 200,
        body: encodeJsonBody({ code: 8, message: '参数错误' }),
      },
    });

    await expect(failedRequest).resolves.toEqual({
      success: false,
      error: '参数错误',
    });

    const invalidDataRequest = service.getDeviceInfo('device-3');
    listeners[0]({
      type: 'http/response',
      body: {
        requestId: sentMessages[2].body.requestId,
        statusCode: 200,
        body: encodeJsonBody({ code: 0, message: '操作成功', data: null }),
      },
    });

    await expect(invalidDataRequest).resolves.toEqual({
      success: false,
      error: '设备信息响应无效',
    });

    service.destroy();
  });

  it('保留设备 HTTP 连接错误原因', async () => {
    vi.useFakeTimers();

    const { listeners, sentMessages, wsService } = createWebSocketService();
    const service = new DeviceControlService(wsService, 'password');
    const deviceInfoRequest = service.getDeviceInfo('device-info-offline');

    listeners[0]({
      type: 'http/response',
      body: {
        requestId: sentMessages[0].body.requestId,
        statusCode: 0,
        body: null,
        error: 'Connection refused',
      },
    });
    await expect(deviceInfoRequest).resolves.toEqual({
      success: false,
      error: 'Connection refused',
    });

    const renameRequest = service.renameDevices([{ udid: 'device-rename-offline', name: '新名称' }]);
    listeners[0]({
      type: 'http/response',
      body: {
        requestId: sentMessages[1].body.requestId,
        statusCode: 0,
        body: null,
        error: 'Connection refused',
      },
    });
    await expect(renameRequest).resolves.toEqual([{
      udid: 'device-rename-offline',
      name: '新名称',
      success: false,
      error: 'Connection refused',
    }]);

    service.destroy();
  });

  it('逐台重命名使用独立请求，并发限制为 5 且结果保持输入顺序', async () => {
    vi.useFakeTimers();

    const { listeners, sentMessages, wsService } = createWebSocketService();
    const service = new DeviceControlService(wsService, 'password');
    const items = Array.from({ length: 6 }, (_, index) => ({
      udid: `device-${index + 1}`,
      name: `name-${index + 1}`,
    }));
    const request = service.renameDevices(items);

    expect(sentMessages).toHaveLength(5);
    for (let index = 0; index < sentMessages.length; index++) {
      expect(sentMessages[index].body).toMatchObject({
        devices: [items[index].udid],
        method: 'POST',
        path: '/set_device_name',
      });
      expect(decodeJsonBody(sentMessages[index].body.body)).toEqual({ name: items[index].name });
    }
    expect(new Set(sentMessages.map((message) => message.body.requestId)).size).toBe(5);

    const respond = (message: any, statusCode: number, body: any) => {
      listeners[0]({
        type: 'http/response',
        body: {
          requestId: message.body.requestId,
          statusCode,
          body: encodeJsonBody(body),
        },
      });
    };

    respond(sentMessages[4], 200, { code: 0, message: '操作成功' });
    await Promise.resolve();

    expect(sentMessages).toHaveLength(6);
    expect(sentMessages[5].body.devices).toEqual(['device-6']);
    expect(decodeJsonBody(sentMessages[5].body.body)).toEqual({ name: 'name-6' });
    expect(new Set(sentMessages.map((message) => message.body.requestId)).size).toBe(6);

    respond(sentMessages[2], 200, { code: 8, message: '参数错误' });
    respond(sentMessages[5], 200, { code: 0, message: '操作成功' });
    respond(sentMessages[1], 503, { message: '设备不可用' });
    respond(sentMessages[3], 200, { code: 0, message: '操作成功' });
    respond(sentMessages[0], 200, { code: 0, message: '操作成功' });

    await expect(request).resolves.toEqual([
      { udid: 'device-1', name: 'name-1', success: true },
      { udid: 'device-2', name: 'name-2', success: false, error: '设备不可用' },
      { udid: 'device-3', name: 'name-3', success: false, error: '参数错误' },
      { udid: 'device-4', name: 'name-4', success: true },
      { udid: 'device-5', name: 'name-5', success: true },
      { udid: 'device-6', name: 'name-6', success: true },
    ]);

    service.destroy();
  });

  it('批量重命名将单台超时记录为失败并保留其他结果', async () => {
    vi.useFakeTimers();

    const { listeners, sentMessages, wsService } = createWebSocketService();
    const service = new DeviceControlService(wsService, 'password');
    const request = service.renameDevices([
      { udid: 'device-timeout', name: '超时设备' },
      { udid: 'device-success', name: '成功设备' },
    ]);

    listeners[0]({
      type: 'http/response',
      body: {
        requestId: sentMessages[1].body.requestId,
        statusCode: 200,
        body: encodeJsonBody({ code: 0, message: '操作成功' }),
      },
    });
    await vi.advanceTimersByTimeAsync(15000);

    await expect(request).resolves.toEqual([
      {
        udid: 'device-timeout',
        name: '超时设备',
        success: false,
        error: 'Request timeout',
      },
      { udid: 'device-success', name: '成功设备', success: true },
    ]);
    expect(vi.getTimerCount()).toBe(0);

    service.destroy();
  });

  it('WebSocket 断开时批量重命名立即结束所有待处理请求', async () => {
    vi.useFakeTimers();

    const { statusListeners, wsService } = createWebSocketService();
    const service = new DeviceControlService(wsService, 'password');
    const request = service.renameDevices([
      { udid: 'device-1', name: '设备一' },
      { udid: 'device-2', name: '设备二' },
    ]);

    statusListeners[0]('disconnected');

    await expect(request).resolves.toEqual([
      {
        udid: 'device-1',
        name: '设备一',
        success: false,
        error: 'WebSocket连接已断开',
      },
      {
        udid: 'device-2',
        name: '设备二',
        success: false,
        error: 'WebSocket连接已断开',
      },
    ]);
    expect(vi.getTimerCount()).toBe(0);

    service.destroy();
  });
});

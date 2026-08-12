// @vitest-environment happy-dom
import { createSignal, type Accessor } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../DialogContext';
import { ToastProvider } from '../ToastContext';
import { I18nProvider } from '../../i18n';
import type { Device } from '../../services/AuthService';
import type { WebSocketService } from '../../services/WebSocketService';
import type { BatchRenameModalProps } from '../BatchRenameModal';
import DeviceList from '../DeviceList';

const batchRenameModalMock = vi.hoisted(() => ({
  props: null as BatchRenameModalProps | null,
}));

const deviceControlMock = vi.hoisted(() => ({
  getDeviceInfo: vi.fn(),
  renameDevices: vi.fn(),
  destroy: vi.fn(),
}));

const authFetchMock = vi.hoisted(() => vi.fn(async () => ({
  ok: true,
  json: async () => ({}),
})));

vi.mock('../BatchRenameModal', () => ({
  default: (props: BatchRenameModalProps) => {
    batchRenameModalMock.props = props;
    return null;
  },
}));

vi.mock('../../services/DeviceControlService', () => ({
  DeviceControlService: class {
    getDeviceInfo = deviceControlMock.getDeviceInfo;
    renameDevices = deviceControlMock.renameDevices;
    destroy = deviceControlMock.destroy;
  },
}));

vi.mock('../../services/httpAuth', () => ({
  authFetch: authFetchMock,
}));

vi.mock('../../hooks/useScriptConfigManager', () => ({
  useScriptConfigManager: () => ({
    checkConfigurable: vi.fn(async () => false),
    ensureGlobalLaunchConfig: vi.fn(async () => true),
    ensureGroupLaunchConfig: vi.fn(async () => true),
    openGlobalConfig: vi.fn(),
    closeConfig: vi.fn(),
    submitConfig: vi.fn(),
    isOpen: () => false,
    configTitle: () => '',
    uiItems: () => [],
    initialValues: () => ({}),
    scriptInfo: () => null,
    submitLabel: () => '',
    validateOnOpen: () => false,
  }),
}));

vi.mock('../WebRTCControl', () => ({ default: () => null }));
vi.mock('../BatchRemoteControl', () => ({ default: () => null }));
vi.mock('../DeviceBindingModal', () => ({ default: () => null }));
vi.mock('../DictionaryModal', () => ({ default: () => null }));
vi.mock('../ScriptSelectionModal', () => ({ ScriptSelectionModal: () => null }));
vi.mock('../ScriptUploadModal', () => ({ ScriptUploadModal: () => null }));
vi.mock('../ServerFileBrowser', () => ({ default: () => null }));
vi.mock('../LogStreamModal', () => ({ default: () => null }));
vi.mock('../ScriptConfigModal', () => ({ default: () => null }));
vi.mock('../../modals/domain/BrightnessModal', () => ({ default: () => null }));
vi.mock('../../modals/domain/VolumeModal', () => ({ default: () => null }));

const flushAsync = () => new Promise(resolve => setTimeout(resolve, 0));

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function device(udid: string, name: string, ip: string): Device {
  return {
    udid,
    system: {
      name,
      ip,
      version: '16.7',
      battery: 80,
    },
    app: { version: '1.3.0' },
    script: { running: false, paused: false },
  };
}

class WebSocketServiceMock {
  updateDeviceMessage = vi.fn();
  updateDeviceName = vi.fn();
  refreshDeviceStates = vi.fn(async () => {});
  replaceScriptStartStates = vi.fn();
  onLastLogUpdate = vi.fn(() => () => {});
  onStatusChange = vi.fn(() => () => {});
}

interface MountOptions {
  devices: Device[];
  selected: Device[];
}

function mountDeviceList(options: MountOptions) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const [devices, setDevices] = createSignal(options.devices);
  const [selected, setSelected] = createSignal(options.selected);
  const onDeviceSelect = vi.fn((next: Device[]) => setSelected(next));
  const webSocketService = new WebSocketServiceMock();

  const dispose = render(() => (
    <I18nProvider defaultLocale="zh-CN">
      <ToastProvider>
        <DialogProvider>
          <DeviceList
            devices={devices()}
            onDeviceSelect={onDeviceSelect}
            selectedDevices={selected as Accessor<Device[]>}
            onRefresh={() => {}}
            onStartScript={() => {}}
            onStopScript={() => {}}
            onRespringDevices={() => {}}
            onUploadFiles={async () => {}}
            onOpenFileBrowser={() => {}}
            webSocketService={webSocketService as unknown as WebSocketService}
            isLoading={false}
            serverHost="127.0.0.1"
            serverPort="46980"
          />
        </DialogProvider>
      </ToastProvider>
    </I18nProvider>
  ), host);

  return {
    devices,
    setDevices,
    selected,
    setSelected,
    onDeviceSelect,
    webSocketService,
    dispose: () => {
      dispose();
      host.remove();
    },
  };
}

function exactTextElement(text: string, selector = '*') {
  const element = [...document.querySelectorAll<HTMLElement>(selector)]
    .find(candidate => candidate.textContent?.trim() === text);
  expect(element, `element with text ${text}`).toBeTruthy();
  return element!;
}

function openContextMenu(deviceName: string) {
  exactTextElement(deviceName, 'div').dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 100,
  }));
}

function batchRenameButtons() {
  return [...document.querySelectorAll<HTMLButtonElement>('button')]
    .filter(button => button.textContent?.trim() === '批量重命名…');
}

describe('DeviceList 批量重命名集成', () => {
  beforeEach(() => {
    batchRenameModalMock.props = null;
    deviceControlMock.getDeviceInfo.mockReset();
    deviceControlMock.renameDevices.mockReset();
    deviceControlMock.destroy.mockReset();
    authFetchMock.mockClear();
    const localStorage = memoryStorage();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: localStorage,
    });
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: localStorage,
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('当前视图没有选中设备时不显示入口，右键未选设备也只处理已选目标', async () => {
    const alpha = device('udid-alpha', 'Alpha', '10.0.0.1');
    const bravo = device('udid-bravo', 'Bravo', '10.0.0.2');
    const outside = device('udid-outside', 'Outside', '10.0.0.9');
    const mounted = mountDeviceList({ devices: [alpha, bravo], selected: [outside] });
    await flushAsync();

    openContextMenu('Alpha');
    expect(batchRenameButtons()).toHaveLength(0);

    mounted.setSelected([bravo]);
    await flushAsync();
    expect(batchRenameButtons()).toHaveLength(1);

    batchRenameButtons()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(batchRenameModalMock.props?.open).toBe(true);
    expect(batchRenameModalMock.props?.targets).toEqual([
      expect.objectContaining({ udid: 'udid-bravo', index1: 2, devname: 'Bravo' }),
    ]);

    batchRenameModalMock.props?.onClose();
    mounted.setSelected([alpha]);
    await flushAsync();
    openContextMenu('Alpha');
    expect(batchRenameButtons()).toHaveLength(1);
    mounted.dispose();
  });

  it('按当前排序后的可见行号生成并冻结目标快照', async () => {
    const charlie = device('udid-charlie', 'Charlie', '10.0.0.3');
    const alpha = device('udid-alpha', 'Alpha', '10.0.0.1');
    const bravo = device('udid-bravo', 'Bravo', '10.0.0.2');
    const mounted = mountDeviceList({
      devices: [charlie, alpha, bravo],
      selected: [charlie, bravo],
    });
    await flushAsync();

    exactTextElement('设备名称', 'div').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();
    openContextMenu('Alpha');
    batchRenameButtons()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    const snapshot = batchRenameModalMock.props?.targets;
    expect(snapshot).toEqual([
      expect.objectContaining({ udid: 'udid-bravo', index1: 2 }),
      expect.objectContaining({ udid: 'udid-charlie', index1: 3 }),
    ]);

    mounted.setDevices([
      device('udid-charlie', 'Aardvark', '10.0.0.3'),
      alpha,
      bravo,
    ]);
    mounted.setSelected([bravo]);
    await flushAsync();
    expect(batchRenameModalMock.props?.targets).toEqual(snapshot);
    mounted.dispose();
  });

  it('部分成功时仅更新成功项、刷新一次并保持原选择', async () => {
    const alpha = device('udid-alpha', 'Alpha', '10.0.0.1');
    const bravo = device('udid-bravo', 'Bravo', '10.0.0.2');
    const mounted = mountDeviceList({ devices: [alpha, bravo], selected: [alpha, bravo] });
    deviceControlMock.renameDevices.mockResolvedValue([
      { udid: 'udid-alpha', name: 'Alpha-1', success: true },
      { udid: 'udid-bravo', name: 'Bravo-2', success: false, error: '设备离线' },
    ]);
    await flushAsync();

    openContextMenu('Alpha');
    batchRenameButtons()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();
    const submitted = await batchRenameModalMock.props!.onSubmit(
      [
        { udid: 'udid-alpha', name: 'Alpha-1' },
        { udid: 'udid-bravo', name: 'Bravo-2' },
      ],
      [],
    );
    await flushAsync();

    expect(submitted).toBe(true);
    expect(deviceControlMock.renameDevices).toHaveBeenCalledWith([
      { udid: 'udid-alpha', name: 'Alpha-1' },
      { udid: 'udid-bravo', name: 'Bravo-2' },
    ]);
    expect(mounted.webSocketService.updateDeviceName).toHaveBeenCalledTimes(1);
    expect(mounted.webSocketService.updateDeviceName).toHaveBeenCalledWith('udid-alpha', 'Alpha-1');
    expect(mounted.webSocketService.refreshDeviceStates).toHaveBeenCalledTimes(1);
    expect(mounted.selected().map(item => item.udid)).toEqual(['udid-alpha', 'udid-bravo']);
    expect(mounted.onDeviceSelect).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('已成功重命名 1 台，1 台失败');
    mounted.dispose();
  });
});

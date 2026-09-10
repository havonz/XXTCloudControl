import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { I18nProvider } from '../i18n';
import RuntimeSettingsModal from '../components/RuntimeSettingsModal';
import { RuntimeSettingsService } from '../services/runtimeSettingsService';
import { RuntimeStatus, RuntimeSettingsError } from '../services/runtimeSettingsProtocol';
import '../index.css';

document.documentElement.setAttribute('data-theme', new URLSearchParams(location.search).get('theme') || 'light');
const mode = new URLSearchParams(location.search).get('mode') || 'batch';
const stateKey = `runtime-fixture-device:${mode}`;
const fixture = { recovered: mode !== 'pending', saves: [] as unknown[] };
Object.assign(window, { __runtimeFixture: fixture });
const initial = (id: string): RuntimeStatus => ({ ok: true, deviceid: id, ready: true, revision: 4,
  profile_generation: id === 'private' ? 2 : 1,
  document_path: id === 'private' ? '/var/mobile/Media/XXTouch-Fixture' : '/var/mobile/Media/1ferver',
  configuration_path: id === 'private' ? '/var/mobile/Media/XXTouch-Fixture/1ferver.conf' : '/var/mobile/Media/1ferver/1ferver.conf',
  active: { port: id === 'private' ? 50152 : 46952, udp_port: id === 'private' ? 50153 : 46953, webdav_port: 46953, log_port: 46957 },
});
const statuses: Record<string, RuntimeStatus> = JSON.parse(localStorage.getItem(stateKey) || 'null') || { shared: initial('shared'), private: initial('private') };
const service = new RuntimeSettingsService({
  read: async id => {
    if (id === 'legacy') throw new RuntimeSettingsError('unsupported', 'unsupported');
    if (!fixture.recovered) throw new Error('设备暂时离线');
    return structuredClone(statuses[id]);
  },
  apply: async (id, request) => {
    fixture.saves.push({ id, request });
    if (id === 'private' && mode === 'batch') throw new RuntimeSettingsError('rejected', '配置已被其它客户端修改，请刷新后重试。');
    statuses[id] = { ...statuses[id], revision: request.expected_revision + 1, active: request.settings,
      profile_generation: request.use_device_directory ? 2 : request.prepare_downgrade ? 1 : statuses[id].profile_generation,
      transaction_id: `fixture-${id}` };
    localStorage.setItem(stateKey, JSON.stringify(statuses));
    if (mode === 'lost') throw new Error('无法发送请求');
  },
});
const targets = mode === 'batch' ? [{ id: 'shared', name: 'iPhone · 共享目录' }, { id: 'private', name: 'iPhone · 专有目录' }, { id: 'legacy', name: '旧版设备' }] : [{ id: 'shared', name: 'iPhone · 测试设备' }];
const count = Math.min(20, Number(new URLSearchParams(location.search).get('count') || '0'));
while (targets.length < count) {
  const id = `extra-${targets.length + 1}`;
  statuses[id] = initial(id);
  targets.push({ id, name: `iPhone · 测试设备 ${targets.length + 1}` });
}
function Fixture() {
  const [open, setOpen] = createSignal(true);
  return <I18nProvider defaultLocale="zh-CN">
    <button id="runtime-open" style={{ margin: '20px' }} onClick={() => setOpen(true)}>目录与端口</button>
    <RuntimeSettingsModal open={open()} targets={targets} service={service}  onClose={() => setOpen(false)} />
  </I18nProvider>;
}
render(() => <Fixture />, document.getElementById('root')!);

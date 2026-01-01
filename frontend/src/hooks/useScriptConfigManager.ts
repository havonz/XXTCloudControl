import { createSignal } from 'solid-js';
import { MainJson, ConfigItem, ScriptInfo } from '../utils/scriptConfig';
import { authFetch } from '../services/httpAuth';

export type ConfigContext = {
  kind: 'global';
  scriptName: string;
} | {
  kind: 'group';
  groupId: string;
  groupName: string;
  scriptPath: string;
};

export function useScriptConfigManager() {
  const [isOpen, setIsOpen] = createSignal(false);
  const [configTitle, setConfigTitle] = createSignal('');
  const [uiItems, setUiItems] = createSignal<ConfigItem[]>([]);
  const [initialValues, setInitialValues] = createSignal<Record<string, any>>({});
  const [activeContext, setActiveContext] = createSignal<ConfigContext | null>(null);
  const [scriptInfo, setScriptInfo] = createSignal<ScriptInfo | null>(null);

  const openGlobalConfig = async (scriptName: string) => {
    try {
      // 1. Get main.json structure and current global config
      const response = await authFetch(`/api/scripts/config?name=${encodeURIComponent(scriptName)}`);
      if (!response.ok) throw new Error('Failed to load config');
      const mainJson: MainJson = await response.json();

      setUiItems(mainJson.UI || []);
      setInitialValues(mainJson.Config || {});
      setScriptInfo(mainJson.ScriptInfo || null);
      setConfigTitle(`全局配置: ${scriptName}`);
      setActiveContext({ kind: 'global', scriptName });
      setIsOpen(true);
    } catch (e) {
      console.error('Failed to open global config', e);
      alert('加载配置失败');
    }
  };

  const openGroupConfig = async (groupId: string, groupName: string, scriptPath: string) => {
    try {
      // 1. Get main.json structure (script defaults)
      const scriptResp = await authFetch(`/api/scripts/config?name=${encodeURIComponent(scriptPath)}`);
      if (!scriptResp.ok) throw new Error('Failed to load script structure');
      const mainJson: MainJson = await scriptResp.json();

      // 2. Get group-specific overrides
      const groupResp = await authFetch(`/api/groups/${groupId}/script-config?script=${encodeURIComponent(scriptPath)}`);
      const groupConfig = groupResp.ok ? await groupResp.json() : {};

      setUiItems(mainJson.UI || []);
      // Merge global defaults with group overrides
      setInitialValues({ ...(mainJson.Config || {}), ...groupConfig });
      setScriptInfo(mainJson.ScriptInfo || null);
      setConfigTitle(`分组配置: ${groupName} (${scriptPath})`);
      setActiveContext({ kind: 'group', groupId, groupName, scriptPath });
      setIsOpen(true);
    } catch (e) {
      console.error('Failed to open group config', e);
      alert('加载分组配置失败');
    }
  };

  const submitConfig = async (values: Record<string, any>) => {
    const ctx = activeContext();
    if (!ctx) return;

    try {
      if (ctx.kind === 'global') {
        const response = await authFetch('/api/scripts/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: ctx.scriptName, config: values })
        });
        if (!response.ok) throw new Error('Save failed');
      } else {
        const response = await authFetch(`/api/groups/${ctx.groupId}/script-config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scriptPath: ctx.scriptPath, config: values })
        });
        if (!response.ok) throw new Error('Save failed');
      }
      setIsOpen(false);
    } catch (e) {
      console.error('Failed to save config', e);
      alert('保存配置失败');
    }
  };

  const checkConfigurable = async (scriptName: string): Promise<boolean> => {
    try {
      const response = await authFetch(`/api/scripts/config-status?name=${encodeURIComponent(scriptName)}`);
      if (!response.ok) return false;
      const data = await response.json();
      return !!data.configurable;
    } catch {
      return false;
    }
  };

  return {
    isOpen,
    configTitle,
    uiItems,
    initialValues,
    scriptInfo,
    openGlobalConfig,
    openGroupConfig,
    submitConfig,
    closeConfig: () => setIsOpen(false),
    checkConfigurable
  };
}

import { createSignal } from 'solid-js';
import { MainJson, ConfigItem, ScriptInfo } from '../utils/scriptConfig';
import { authFetch } from '../services/httpAuth';
import { getCurrentLocale, translate } from '../i18n';

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
  const t = (key: string, vars?: Record<string, unknown>) => translate(getCurrentLocale(), key, vars);
  const [isOpen, setIsOpen] = createSignal(false);
  const [configTitle, setConfigTitle] = createSignal('');
  const [uiItems, setUiItems] = createSignal<ConfigItem[]>([]);
  const [initialValues, setInitialValues] = createSignal<Record<string, any>>({});
  const [activeContext, setActiveContext] = createSignal<ConfigContext | null>(null);
  const [scriptInfo, setScriptInfo] = createSignal<ScriptInfo | null>(null);
  let openRequestVersion = 0;

  function nextOpenRequest(): number {
    openRequestVersion++;
    return openRequestVersion;
  }

  function isCurrentOpenRequest(version: number): boolean {
    return version === openRequestVersion;
  }

  const openGlobalConfig = async (scriptName: string): Promise<void> => {
    const requestVersion = nextOpenRequest();
    try {
      const response = await authFetch(`/api/scripts/config?name=${encodeURIComponent(scriptName)}`);
      if (!isCurrentOpenRequest(requestVersion)) return;
      if (!response.ok) throw new Error('Failed to load config');
      const mainJson: MainJson = await response.json();
      if (!isCurrentOpenRequest(requestVersion)) return;

      setUiItems(mainJson.UI || []);
      setInitialValues(mainJson.Config || {});
      setScriptInfo(mainJson.ScriptInfo || null);
      setConfigTitle(t('form.global_config_title', { name: scriptName }));
      setActiveContext({ kind: 'global', scriptName });
      setIsOpen(true);
    } catch (e) {
      if (!isCurrentOpenRequest(requestVersion)) return;
      console.error('Failed to open global config', e);
      alert(t('form.load_config_failed'));
    }
  };

  const openGroupConfig = async (groupId: string, groupName: string, scriptPath: string): Promise<void> => {
    const requestVersion = nextOpenRequest();
    try {
      const scriptResp = await authFetch(`/api/scripts/config?name=${encodeURIComponent(scriptPath)}`);
      if (!isCurrentOpenRequest(requestVersion)) return;
      if (!scriptResp.ok) throw new Error('Failed to load script structure');
      const mainJson: MainJson = await scriptResp.json();
      if (!isCurrentOpenRequest(requestVersion)) return;

      const groupResp = await authFetch(`/api/groups/${groupId}/script-config?script=${encodeURIComponent(scriptPath)}`);
      if (!isCurrentOpenRequest(requestVersion)) return;
      const groupConfig = groupResp.ok ? await groupResp.json() : {};
      if (!isCurrentOpenRequest(requestVersion)) return;

      setUiItems(mainJson.UI || []);
      setInitialValues({ ...(mainJson.Config || {}), ...groupConfig });
      setScriptInfo(mainJson.ScriptInfo || null);
      setConfigTitle(t('form.group_config_title', { group: groupName, script: scriptPath }));
      setActiveContext({ kind: 'group', groupId, groupName, scriptPath });
      setIsOpen(true);
    } catch (e) {
      if (!isCurrentOpenRequest(requestVersion)) return;
      console.error('Failed to open group config', e);
      alert(t('form.load_group_config_failed'));
    }
  };

  const submitConfig = async (values: Record<string, any>): Promise<void> => {
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
      alert(t('form.save_config_failed'));
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

  const closeConfig = (): void => {
    openRequestVersion++;
    setIsOpen(false);
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
    closeConfig,
    checkConfigurable
  };
}

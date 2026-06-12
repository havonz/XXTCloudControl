import { createSignal } from 'solid-js';
import { MainJson, ConfigItem, ScriptInfo } from '../utils/scriptConfig';
import { authFetch } from '../services/httpAuth';
import { getCurrentLocale, translate } from '../i18n';
import { buildEffectiveScriptConfig, shouldPromptForScriptConfig } from '../utils/scriptRunOptions';

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
  const [submitLabel, setSubmitLabel] = createSignal<string | undefined>();
  const [validateOnOpen, setValidateOnOpen] = createSignal(false);
  const [configMode, setConfigMode] = createSignal<'edit' | 'launch'>('edit');
  let openRequestVersion = 0;
  let pendingLaunchResolve: ((submitted: boolean) => void) | null = null;

  function nextOpenRequest(): number {
    openRequestVersion++;
    return openRequestVersion;
  }

  function isCurrentOpenRequest(version: number): boolean {
    return version === openRequestVersion;
  }

  function resolvePendingLaunch(submitted: boolean): void {
    const resolve = pendingLaunchResolve;
    pendingLaunchResolve = null;
    resolve?.(submitted);
  }

  function resetModeState(): void {
    setSubmitLabel(undefined);
    setValidateOnOpen(false);
    setConfigMode('edit');
  }

  function openConfigModal(
    context: ConfigContext,
    mainJson: MainJson,
    values: Record<string, any>,
    title: string,
    mode: 'edit' | 'launch',
  ): void {
    setUiItems(mainJson.UI || []);
    setInitialValues(values);
    setScriptInfo(mainJson.ScriptInfo || null);
    setConfigTitle(title);
    setActiveContext(context);
    setConfigMode(mode);
    setSubmitLabel(mode === 'launch' ? t('form.submit_and_start') : undefined);
    setValidateOnOpen(mode === 'launch');
    setIsOpen(true);
  }

  const openGlobalConfig = async (scriptName: string): Promise<void> => {
    resolvePendingLaunch(false);
    const requestVersion = nextOpenRequest();
    try {
      const response = await authFetch(`/api/scripts/config?name=${encodeURIComponent(scriptName)}`);
      if (!isCurrentOpenRequest(requestVersion)) return;
      if (!response.ok) throw new Error('Failed to load config');
      const mainJson: MainJson = await response.json();
      if (!isCurrentOpenRequest(requestVersion)) return;

      openConfigModal(
        { kind: 'global', scriptName },
        mainJson,
        mainJson.Config || {},
        t('form.global_config_title', { name: scriptName }),
        'edit',
      );
    } catch (e) {
      if (!isCurrentOpenRequest(requestVersion)) return;
      console.error('Failed to open global config', e);
      alert(t('form.load_config_failed'));
    }
  };

  const openGroupConfig = async (groupId: string, groupName: string, scriptPath: string): Promise<void> => {
    resolvePendingLaunch(false);
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

      openConfigModal(
        { kind: 'group', groupId, groupName, scriptPath },
        mainJson,
        buildEffectiveScriptConfig(mainJson, groupConfig),
        t('form.group_config_title', { group: groupName, script: scriptPath }),
        'edit',
      );
    } catch (e) {
      if (!isCurrentOpenRequest(requestVersion)) return;
      console.error('Failed to open group config', e);
      alert(t('form.load_group_config_failed'));
    }
  };

  const ensureGlobalLaunchConfig = async (scriptName: string): Promise<boolean> => {
    resolvePendingLaunch(false);
    const requestVersion = nextOpenRequest();
    try {
      const response = await authFetch(`/api/scripts/config?name=${encodeURIComponent(scriptName)}`);
      if (!isCurrentOpenRequest(requestVersion)) return false;
      if (!response.ok) return true;
      const mainJson: MainJson = await response.json();
      if (!isCurrentOpenRequest(requestVersion)) return false;

      if (!shouldPromptForScriptConfig(mainJson)) return true;

      return await new Promise<boolean>((resolve) => {
        pendingLaunchResolve = resolve;
        openConfigModal(
          { kind: 'global', scriptName },
          mainJson,
          mainJson.Config || {},
          t('form.global_config_title', { name: scriptName }),
          'launch',
        );
      });
    } catch (e) {
      if (!isCurrentOpenRequest(requestVersion)) return false;
      console.error('Failed to prepare launch config', e);
      alert(t('form.load_config_failed'));
      return false;
    }
  };

  const ensureGroupLaunchConfig = async (groupId: string, groupName: string, scriptPath: string): Promise<boolean> => {
    resolvePendingLaunch(false);
    const requestVersion = nextOpenRequest();
    try {
      const scriptResp = await authFetch(`/api/scripts/config?name=${encodeURIComponent(scriptPath)}`);
      if (!isCurrentOpenRequest(requestVersion)) return false;
      if (!scriptResp.ok) return true;
      const mainJson: MainJson = await scriptResp.json();
      if (!isCurrentOpenRequest(requestVersion)) return false;

      const groupResp = await authFetch(`/api/groups/${groupId}/script-config?script=${encodeURIComponent(scriptPath)}`);
      if (!isCurrentOpenRequest(requestVersion)) return false;
      const groupConfig = groupResp.ok ? await groupResp.json() : {};
      if (!isCurrentOpenRequest(requestVersion)) return false;

      if (!shouldPromptForScriptConfig(mainJson, groupConfig)) return true;

      return await new Promise<boolean>((resolve) => {
        pendingLaunchResolve = resolve;
        openConfigModal(
          { kind: 'group', groupId, groupName, scriptPath },
          mainJson,
          buildEffectiveScriptConfig(mainJson, groupConfig),
          t('form.group_config_title', { group: groupName, script: scriptPath }),
          'launch',
        );
      });
    } catch (e) {
      if (!isCurrentOpenRequest(requestVersion)) return false;
      console.error('Failed to prepare group launch config', e);
      alert(t('form.load_group_config_failed'));
      return false;
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
      if (configMode() === 'launch') {
        resolvePendingLaunch(true);
      }
      resetModeState();
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
    resolvePendingLaunch(false);
    resetModeState();
  };

  return {
    isOpen,
    configTitle,
    uiItems,
    initialValues,
    scriptInfo,
    submitLabel,
    validateOnOpen,
    openGlobalConfig,
    openGroupConfig,
    ensureGlobalLaunchConfig,
    ensureGroupLaunchConfig,
    submitConfig,
    closeConfig,
    checkConfigurable
  };
}

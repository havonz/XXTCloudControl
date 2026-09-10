import { Select, createListCollection } from '@ark-ui/solid/select';
import { Portal } from 'solid-js/web';
import modalStyles from './BatchRenameModal.module.css';
import styles from './RuntimeSettingsForm.module.css';
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from 'solid-js';
import { useI18n } from '../i18n';
import { prepareRuntimeChange, isRuntimeSettingsEditable, runtimePortKeys, RuntimePorts, RuntimeSettingsError, RuntimeStatus, PendingRuntimeChange } from '../services/runtimeSettingsProtocol';
import { RuntimeSettingsService } from '../services/runtimeSettingsService';

export interface RuntimeTarget { id: string; name: string }
interface PreviewRow { target: RuntimeTarget; before?: RuntimeStatus; change?: PendingRuntimeChange; loadError?: string; error?: string }
export default function RuntimeSettingsForm(props: { targets: RuntimeTarget[]; service: RuntimeSettingsService; concurrency: number; runBatch?: (changes: PendingRuntimeChange[], worker: (change: PendingRuntimeChange) => Promise<void>) => Promise<void>; onClose: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = createSignal<PreviewRow[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  const [previewed, setPreviewed] = createSignal(false);
  const [values, setValues] = createSignal<RuntimePorts>({ port: 46952, udp_port: 46953, webdav_port: 46953, log_port: 46957 });
  const [directory, setDirectory] = createSignal(false);
  const directoryOptions = createMemo(() => createListCollection({ items: [
    { value: 'shared', label: t('runtime.shared') },
    { value: 'private', label: t('runtime.private') },
  ] }));
  const [checked, setChecked] = createSignal(new Set<string>());
  const [revision, setRevision] = createSignal(0);
  let closed = false;
  onCleanup(() => { closed = true; });
  onCleanup(props.service.subscribe(() => setRevision(value => value + 1)));
  const operation = (id: string) => {
    revision();
    const current = props.service.get(id);
    // 服务原地更新操作记录，给响应式视图新的快照以通知完成状态。
    return current ? { ...current } : undefined;
  };
  const label = (key: string) => t(`runtime.${key}`);
  const errorMessage = (error: unknown): string => {
    if (error instanceof RuntimeSettingsError && error.reason === 'unsupported') return t('runtime.unsupported');
    const text = error instanceof Error ? error.message : String(error);
    if (text === 'Invalid ports or duplicate TCP ports.') return t('runtime.invalidPorts');
    if (text === 'runtime settings changed; reload and try again' || text === 'Device settings changed or are busy. Refresh and try again.') return t('runtime.conflict');
    if (text === 'Device settings are being updated.' || text === 'Device settings are not ready.') return t('runtime.busy');
    if (text === 'Could not verify the device identity' || text === 'Device identity does not match') return t('runtime.identity');
    return text;
  };
  const work = async <T,>(items: T[], worker: (item: T) => Promise<void>) => {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, props.concurrency)) }, async () => {
      while (next < items.length) await worker(items[next++]);
    }));
  };
  const refresh = async () => {
    if (submitting()) return;
    setLoading(true); setPreviewed(false);
    const targets = props.targets.slice();
    setRows(targets.map(target => ({ target })));
    await work(targets, async target => {
      let row: PreviewRow;
      try {
        const before = await props.service.read(target.id);
        row = { target, before };
        if (!isRuntimeSettingsEditable(before)) row.error = t('runtime.busy');
        if (targets.length === 1) { setValues({ ...before.active }); setDirectory(before.profile_generation === 2); }
      } catch (error) { row = { target, error: errorMessage(error) }; }
      row.loadError = row.error;
      if (!closed) setRows(items => items.map(item => item.target.id === target.id ? row : item));
    });
    if (!closed) setLoading(false);
  };
  createEffect(on(() => props.targets, () => {
    setChecked(new Set(props.targets.length === 1 ? [...runtimePortKeys, 'deviceDirectory'] : []));
    void refresh();
  }));
  const preview = () => {
    const patch: Partial<RuntimePorts> & { deviceDirectory?: boolean } = {};
    for (const key of runtimePortKeys) if (checked().has(key)) patch[key] = values()[key];
    if (checked().has('deviceDirectory')) patch.deviceDirectory = directory();
    setRows(items => items.map(row => {
      if (!row.before || row.loadError) return row;
      try { return { ...row, error: undefined, change: prepareRuntimeChange(row.target.id, row.before, patch) }; }
      catch (error) { return { ...row, change: undefined, error: errorMessage(error) }; }
    }));
    setPreviewed(true);
  };
  const submit = async () => {
    if (!previewed() || submitting()) return;
    setSubmitting(true);
    const changes = rows().filter(row => row.change && !row.error).map(row => row.change!);
    const worker = async (change: PendingRuntimeChange) => {
      try { await props.service.submit(change); }
      catch (error) { if (!closed) setRows(items => items.map(item => item.target.id === change.deviceId ? { ...item, error: errorMessage(error) } : item)); }
    };
    if (props.runBatch) await props.runBatch(changes, worker);
    else await work(changes, worker);

    if (!closed) { setSubmitting(false); setPreviewed(false); }
  };
  const toggle = (key: string, value: boolean) => { setChecked(previous => { const next = new Set(previous); if (value) next.add(key); else next.delete(key); return next; }); setPreviewed(false); };
  return <div class={styles.form}>
    <div class={styles.body}>
      <p id="runtime-settings-hint" class={styles.hint}>{t(props.targets.length > 1 ? 'runtime.batchHint' : 'runtime.singleHint')}</p>
      <fieldset class={styles.fields} disabled={loading() || submitting()}>
        <div class={styles.field}>
          <label class={styles.label} for={props.targets.length > 1 ? 'runtime-change-directory' : undefined}>
            <Show when={props.targets.length > 1}><input id="runtime-change-directory" type="checkbox" aria-label={t('runtime.changeDirectory')} checked={checked().has('deviceDirectory')} onChange={event => toggle('deviceDirectory', event.currentTarget.checked)} /></Show>
            <span>{t('runtime.directory')}</span>
          </label>
          <Select.Root collection={directoryOptions()} value={[directory() ? 'private' : 'shared']}
            disabled={loading() || submitting() || !checked().has('deviceDirectory')}
            onValueChange={event => { setDirectory(event.value[0] === 'private'); setPreviewed(false); }}>
            <Select.Control>
              <Select.Trigger class="cbx-select" aria-label={t('runtime.directory')}>
                <Select.ValueText /><span class="dropdown-arrow" aria-hidden="true">▼</span>
              </Select.Trigger>
            </Select.Control>
            <Portal>
              <Select.Positioner style={{ 'z-index': 10060, width: 'var(--reference-width)' }}>
                <Select.Content class="cbx-panel">
                  <For each={directoryOptions().items}>{item => <Select.Item item={item} class="cbx-item">
                    <Select.ItemText>{item.label}</Select.ItemText><Select.ItemIndicator>✓</Select.ItemIndicator>
                  </Select.Item>}</For>
                </Select.Content>
              </Select.Positioner>
            </Portal>
            <Select.HiddenSelect />
          </Select.Root>
        </div>
        <For each={runtimePortKeys}>{key => <div class={styles.field}>
          <label class={styles.label} for={props.targets.length > 1 ? `runtime-change-${key}` : `runtime-${key}`}>
            <Show when={props.targets.length > 1}><input id={`runtime-change-${key}`} type="checkbox" aria-label={label(key)} checked={checked().has(key)} onChange={event => toggle(key, event.currentTarget.checked)} /></Show>
            <span>{label(key)}</span>
          </label>
          <input class={`${modalStyles.patternInput} ${styles.port}`} id={`runtime-${key}`} aria-label={label(key)} type="number" min={key === 'port' ? 10000 : 0} max="65535" step="1" value={values()[key]} disabled={!checked().has(key)} onInput={event => { setValues(previous => ({ ...previous, [key]: event.currentTarget.value === '' ? NaN : Number(event.currentTarget.value) })); setPreviewed(false); }} />
        </div>}</For>
        <p class={styles.hint}>{t('runtime.portHint')}</p>
        <button class={modalStyles.exampleButton} onClick={preview} disabled={!checked().size || loading()}>{t('runtime.preview')}</button>
      </fieldset>
      <div class={styles.results} aria-live="polite">
        <For each={rows()}>{row => <section class={styles.result}>
          <strong class={styles.name}>{row.target.name}</strong>
          <Show when={row.before}>{before => <>
            <dl class={styles.details}>
              <dt>{t('runtime.document')}</dt><dd>{before().document_path}</dd>
              <dt>{t('runtime.configuration')}</dt><dd>{before().configuration_path}</dd>
            </dl>
            <Show when={previewed() && row.change}>{change => <dl class={styles.changes}>
              <For each={runtimePortKeys}>{key => <><dt>{label(key)}</dt><dd>{before().active[key]} → {change().request.settings[key]}</dd></>}</For>
              <dt>{t('runtime.directory')}</dt><dd>{t(before().profile_generation === 2 ? 'runtime.private' : 'runtime.shared')} → {t(change().profileGeneration === 2 ? 'runtime.private' : 'runtime.shared')}</dd>
            </dl>}</Show>
          </>}</Show>
          <Show when={row.error}><p class={styles.error} role="alert">{row.error}</p></Show>
          <Show when={operation(row.target.id)}>{current => <p class={styles.status}>{t(`runtime.${current().state}`)} {errorMessage(current().error || '')}
          </p>}</Show>
          <Show when={!row.before && !row.error}><p class={styles.hint}>{t('runtime.loading')}</p></Show>
        </section>}</For>
      </div>
    </div>
    <div class={modalStyles.footer}>
      <button class={`${modalStyles.cancelButton} ${styles.close}`} title={`${t('runtime.close')} (Esc)`} onClick={props.onClose}><span>{t('runtime.close')}</span></button>
      <button class={modalStyles.cancelButton} disabled={loading() || submitting()} onClick={() => void refresh()}>{t('runtime.refresh')}</button>
      <button class={modalStyles.submitButton} disabled={!previewed() || submitting() || !rows().some(row => row.change && !row.error)} onClick={() => void submit()}>{t('runtime.apply')}</button>
    </div>
  </div>;
}

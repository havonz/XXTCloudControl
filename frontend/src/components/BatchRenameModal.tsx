import { Index, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { createBackdropClose } from '../hooks/useBackdropClose';
import { IconXmark } from '../icons';
import { useI18n } from '../i18n';
import {
  formatBatchRenameName,
  type BatchRenamePatternDevice,
} from '../utils/batchRename';
import styles from './BatchRenameModal.module.css';

export interface BatchRenameTarget extends BatchRenamePatternDevice {
  udid: string;
  index1: number;
}

export interface DeviceTypeLoadResult {
  success: boolean;
  devtype?: string;
  error?: string;
}

export interface BatchRenameSubmitItem {
  udid: string;
  name: string;
}

export interface BatchRenameSkippedItem {
  udid: string;
  name: string;
  error: string;
}

export interface BatchRenameModalProps {
  open: boolean;
  targets: BatchRenameTarget[];
  onClose: () => void;
  loadDeviceType: (udid: string) => Promise<DeviceTypeLoadResult>;
  onSubmit: (
    items: BatchRenameSubmitItem[],
    skipped: BatchRenameSkippedItem[],
  ) => Promise<boolean>;
}

interface PreviewRow {
  target: BatchRenameTarget;
  originalName: string;
  name: string;
  status?: string;
  error?: string;
}

const DEFAULT_PATTERN = '{devname}';
const EXAMPLE_PATTERN = '{devtype}-{ip:4}';
const deviceTypeCache = new Map<string, string>();

export default function BatchRenameModal(props: BatchRenameModalProps) {
  const { t } = useI18n();
  const [pattern, setPattern] = createSignal(DEFAULT_PATTERN);
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [loadedDeviceTypes, setLoadedDeviceTypes] = createSignal(new Map<string, string>());
  const [deviceTypeErrors, setDeviceTypeErrors] = createSignal(new Map<string, string>());
  const [loadingDeviceIds, setLoadingDeviceIds] = createSignal(new Set<string>());
  const usesDeviceType = createMemo(() => pattern().includes('{devtype}'));
  const isLoadingDeviceTypes = createMemo(() => usesDeviceType() && loadingDeviceIds().size > 0);

  let inputRef: HTMLInputElement | undefined;
  let wasOpen = false;
  let openCycle = 0;
  let requestedDeviceTypes = new Set<string>();

  const handleClose = () => {
    if (isSubmitting()) return;
    props.onClose();
  };
  const backdropClose = createBackdropClose(handleClose);

  createEffect(() => {
    if (!props.open) {
      if (wasOpen) openCycle += 1;
      wasOpen = false;
      return;
    }
    if (wasOpen) return;

    wasOpen = true;
    openCycle += 1;
    requestedDeviceTypes = new Set<string>();
    setPattern(DEFAULT_PATTERN);
    setIsSubmitting(false);
    setDeviceTypeErrors(new Map<string, string>());
    setLoadingDeviceIds(new Set<string>());

    const initialDeviceTypes = new Map<string, string>();
    for (const target of props.targets) {
      const targetDeviceType = typeof target.devtype === 'string' ? target.devtype.trim() : '';
      if (targetDeviceType) {
        deviceTypeCache.set(target.udid, targetDeviceType);
      }
      if (deviceTypeCache.has(target.udid)) {
        initialDeviceTypes.set(target.udid, deviceTypeCache.get(target.udid) ?? '');
      }
    }
    setLoadedDeviceTypes(initialDeviceTypes);

    const focusTimer = window.setTimeout(() => {
      inputRef?.focus();
      inputRef?.select();
    });
    onCleanup(() => window.clearTimeout(focusTimer));
  });

  createEffect(() => {
    const isOpen = props.open;
    const needsDeviceType = usesDeviceType();
    const targets = props.targets;
    const availableDeviceTypes = loadedDeviceTypes();
    if (!isOpen || !needsDeviceType) return;

    const pendingTargets = targets.filter(target => {
      const hasTargetDeviceType = typeof target.devtype === 'string' && target.devtype.trim().length > 0;
      return !hasTargetDeviceType
        && !availableDeviceTypes.has(target.udid)
        && !requestedDeviceTypes.has(target.udid);
    });
    if (!pendingTargets.length) return;

    const cycle = openCycle;
    for (const target of pendingTargets) requestedDeviceTypes.add(target.udid);
    setLoadingDeviceIds(previous => {
      const next = new Set(previous);
      for (const target of pendingTargets) next.add(target.udid);
      return next;
    });

    for (const target of pendingTargets) {
      void props.loadDeviceType(target.udid)
        .then(result => {
          const deviceType = result.devtype?.trim() ?? '';
          if (result.success && deviceType) {
            deviceTypeCache.set(target.udid, deviceType);
            if (cycle !== openCycle) return;

            setLoadedDeviceTypes(previous => {
              const next = new Map(previous);
              next.set(target.udid, deviceType);
              return next;
            });
            setDeviceTypeErrors(previous => {
              const next = new Map(previous);
              next.delete(target.udid);
              return next;
            });
            return;
          }

          if (cycle !== openCycle) return;
          setDeviceTypeErrors(previous => {
            const next = new Map(previous);
            next.set(
              target.udid,
              result.error?.trim() || t('device_list.batch_rename.device_type_load_failed'),
            );
            return next;
          });
        })
        .catch(error => {
          if (cycle !== openCycle) return;
          const message = error instanceof Error && error.message.trim()
            ? error.message
            : t('device_list.batch_rename.device_type_load_failed');
          setDeviceTypeErrors(previous => {
            const next = new Map(previous);
            next.set(target.udid, message);
            return next;
          });
        })
        .finally(() => {
          if (cycle !== openCycle) return;
          setLoadingDeviceIds(previous => {
            const next = new Set(previous);
            next.delete(target.udid);
            return next;
          });
        });
    }
  });

  const previewRows = createMemo<PreviewRow[]>(() => {
    const currentPattern = pattern();
    const needsDeviceType = usesDeviceType();
    const deviceTypes = loadedDeviceTypes();
    const errors = deviceTypeErrors();
    const loadingIds = loadingDeviceIds();
    const submitting = isSubmitting();

    return props.targets.map(target => {
      const hasTargetDeviceType = typeof target.devtype === 'string' && target.devtype.trim().length > 0;
      const deviceType = hasTargetDeviceType
        ? target.devtype
        : deviceTypes.has(target.udid)
          ? deviceTypes.get(target.udid)
          : target.devtype;
      const device = deviceType === target.devtype ? target : { ...target, devtype: deviceType };
      const error = needsDeviceType ? errors.get(target.udid) : undefined;
      const status = error
        ?? (needsDeviceType && loadingIds.has(target.udid)
          ? t('device_list.batch_rename.device_type_loading')
          : submitting
            ? t('device_list.batch_rename.renaming')
            : undefined);

      return {
        target,
        originalName: target.devname || target.udid,
        name: formatBatchRenameName(currentPattern, device, target.index1),
        status,
        error,
      };
    });
  });

  const handleSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!pattern().trim() || isSubmitting() || isLoadingDeviceTypes()) return;

    const items: BatchRenameSubmitItem[] = [];
    const skipped: BatchRenameSkippedItem[] = [];
    for (const row of previewRows()) {
      if (row.error) {
        skipped.push({ udid: row.target.udid, name: row.name, error: row.error });
      } else {
        items.push({ udid: row.target.udid, name: row.name });
      }
    }

    setIsSubmitting(true);
    try {
      const shouldClose = await props.onSubmit(items, skipped);
      if (shouldClose) props.onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  createEffect(() => {
    if (!props.open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => window.removeEventListener('keydown', handleKeyDown));
  });

  return (
    <Show when={props.open}>
      <div
        class={styles.overlay}
        onMouseDown={backdropClose.onMouseDown}
        onMouseUp={backdropClose.onMouseUp}
      >
        <section
          class={styles.modal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="batch-rename-title"
          onMouseDown={event => event.stopPropagation()}
        >
          <header class={styles.header}>
            <div>
              <h2 id="batch-rename-title" class={styles.title}>
                {t('device_list.batch_rename.title')}
              </h2>
              <p class={styles.targetCount}>
                {t('device_list.batch_rename.target_count', { count: props.targets.length })}
              </p>
            </div>
            <button
              type="button"
              class={styles.closeButton}
              onClick={handleClose}
              disabled={isSubmitting()}
              title={t('device_list.batch_rename.close')}
              aria-label={t('device_list.batch_rename.close')}
            >
              <IconXmark size={16} />
            </button>
          </header>

          <form class={styles.form} onSubmit={handleSubmit}>
            <div class={styles.body}>
              <div class={styles.ruleGroup}>
                <label for="batch-rename-pattern" class={styles.label}>
                  {t('device_list.batch_rename.pattern_label')}
                </label>
                <div class={styles.ruleControls}>
                  <input
                    ref={inputRef}
                    id="batch-rename-pattern"
                    class={styles.patternInput}
                    type="text"
                    value={pattern()}
                    onInput={event => setPattern(event.currentTarget.value)}
                    placeholder={t('device_list.batch_rename.pattern_placeholder')}
                    disabled={isSubmitting()}
                  />
                  <button
                    type="button"
                    class={styles.exampleButton}
                    onClick={() => setPattern(EXAMPLE_PATTERN)}
                    disabled={isSubmitting()}
                  >
                    <span>{t('device_list.batch_rename.example')}</span>
                    <code>{EXAMPLE_PATTERN}</code>
                  </button>
                </div>
                <p class={styles.placeholderHelp}>
                  {t('device_list.batch_rename.placeholders_prefix')}
                  <code>{'{ip}'}</code>
                  <code>{'{ip:n}'}</code>
                  <code>{'{ip:a..b}'}</code>
                  <code>{'{index}'}</code>
                  <code>{'{index:start}'}</code>
                  <code>{'{index:start:end}'}</code>
                  <code>{'{devname}'}</code>
                  <code>{'{devname:start,end}'}</code>
                  <code>{'{devtype}'}</code>
                  <code>{'{sysversion}'}</code>
                  <code>{'{zeversion}'}</code>
                </p>
              </div>

              <div class={styles.previewHeader}>
                <h3>{t('device_list.batch_rename.preview_title')}</h3>
              </div>
              <div class={styles.preview} aria-live="polite">
                <Show
                  when={previewRows().length > 0}
                  fallback={<div class={styles.empty}>{t('device_list.batch_rename.empty')}</div>}
                >
                  <ul class={styles.previewList}>
                    <Index each={previewRows()}>{row => (
                      <li class={styles.previewRow}>
                        <div class={styles.renamePair}>
                          <span class={styles.originalName} title={row().originalName}>
                            {row().originalName}
                          </span>
                          <span class={styles.arrow} aria-hidden="true">→</span>
                          <strong class={styles.nextName} title={row().name}>
                            {row().name}
                          </strong>
                        </div>
                        <Show when={row().status}>
                          <div
                            class={`${styles.rowStatus} ${row().error ? styles.rowError : ''}`}
                            role={row().error ? 'alert' : undefined}
                          >
                            {row().status}
                          </div>
                        </Show>
                      </li>
                    )}</Index>
                  </ul>
                </Show>
              </div>
            </div>

            <footer class={styles.footer}>
              <button
                type="button"
                class={styles.cancelButton}
                onClick={handleClose}
                disabled={isSubmitting()}
              >
                {t('device_list.batch_rename.cancel')}
              </button>
              <button
                type="submit"
                class={styles.submitButton}
                disabled={!pattern().trim() || isSubmitting() || isLoadingDeviceTypes()}
              >
                {isSubmitting()
                  ? t('device_list.batch_rename.processing')
                  : isLoadingDeviceTypes()
                    ? t('device_list.batch_rename.loading_device_types')
                    : t('device_list.batch_rename.submit')}
              </button>
            </footer>
          </form>
        </section>
      </div>
    </Show>
  );
}

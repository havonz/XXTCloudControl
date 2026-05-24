import { Show, createEffect, onCleanup } from 'solid-js';
import { createBackdropClose } from '../../hooks/useBackdropClose';
import { IconXmark } from '../../icons';
import { useI18n } from '../../i18n';
import styles from '../../components/ScriptSelectionModal.module.css';

interface BrightnessModalProps {
  open: boolean;
  setting: boolean;
  value: number; // 0-100
  onChange: (v: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
  selectedDeviceCount: number;
}

export default function BrightnessModal(props: BrightnessModalProps) {
  const { t } = useI18n();
  const backdropClose = createBackdropClose(() => {
    if (!props.setting) props.onCancel();
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!props.open) return;
    if (e.key === 'Escape' && !props.setting) {
      props.onCancel();
    } else if (e.key === 'Enter' && !props.setting) {
      props.onConfirm();
    }
  };

  createEffect(() => {
    if (!props.open) return;

    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
    });
  });

  return (
    <Show when={props.open}>
      <div class={styles.overlay} onMouseDown={backdropClose.onMouseDown} onMouseUp={backdropClose.onMouseUp}>
        <div class={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
          <div class={styles.header}>
            <h3 class={styles.title}>{t('modal.brightness_title')}</h3>
            <button 
              class={styles.closeButton} 
              onClick={props.onCancel} 
              title={t('common.close')}
              disabled={props.setting}
            >
              <IconXmark size={16} />
            </button>
          </div>

          <div class={styles.body}>
            <p class={styles.description}>{t('modal.brightness_description', { count: props.selectedDeviceCount })}</p>
            
            <div class={styles.inputGroup}>
              <div class={styles.inputRow}>
                <span style={{ "min-width": "40px", color: "var(--text-secondary)" }}>{t('modal.brightness_label')}</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  style={{ flex: 1 }}
                  value={props.value}
                  onInput={(e) => props.onChange(parseInt((e.target as HTMLInputElement).value))}
                  disabled={props.setting}
                />
                <span style={{ "min-width": "50px", "text-align": "right" }}>{props.value}%</span>
                <button
                  onClick={props.onConfirm}
                  disabled={props.setting}
                  class={styles.selectButton}
                >
                  {props.setting ? t('modal.setting') : t('common.confirm')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}

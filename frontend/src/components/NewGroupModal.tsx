import { Component, createSignal, Show, createEffect } from 'solid-js';
import { createBackdropClose } from '../hooks/useBackdropClose';
import { useI18n } from '../i18n';
import styles from './NewGroupModal.module.css';

interface NewGroupModalProps {
  open: boolean;
  onClose: () => void;
  onCreateGroup: (name: string) => Promise<boolean>;
}

const NewGroupModal: Component<NewGroupModalProps> = (props) => {
  const { t } = useI18n();
  const [name, setName] = createSignal('');
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

  const backdropClose = createBackdropClose(() => props.onClose());

  // Focus input when modal opens
  createEffect(() => {
    if (props.open) {
      setName('');
      setIsSubmitting(false);
      setTimeout(() => inputRef?.focus(), 50);
    }
  });

  const handleSubmit = async (e?: Event) => {
    e?.preventDefault();
    const trimmedName = name().trim();
    if (!trimmedName || isSubmitting()) return;

    setIsSubmitting(true);
    const success = await props.onCreateGroup(trimmedName);
    setIsSubmitting(false);

    if (success) {
      props.onClose();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      props.onClose();
    }
  };

  return (
    <Show when={props.open}>
      <div class={styles.backdrop} onMouseDown={backdropClose.onMouseDown} onMouseUp={backdropClose.onMouseUp}>
        <div class={styles.modal} onMouseDown={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
          <h3 class={styles.title}>{t('group.new_title')}</h3>
          <form onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              type="text"
              class={styles.input}
              placeholder={t('group.name_placeholder')}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              disabled={isSubmitting()}
            />
            <div class={styles.actions}>
              <button 
                type="button" 
                class={styles.cancelButton}
                onClick={props.onClose}
                disabled={isSubmitting()}
              >
                {t('common.cancel')}
              </button>
              <button 
                type="submit"
                class={styles.submitButton}
                disabled={!name().trim() || isSubmitting()}
              >
                {isSubmitting() ? t('common.creating') : t('common.create')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
};

export default NewGroupModal;

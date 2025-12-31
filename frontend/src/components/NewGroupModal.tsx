import { Component, createSignal, Show, createEffect } from 'solid-js';
import styles from './NewGroupModal.module.css';

interface NewGroupModalProps {
  open: boolean;
  onClose: () => void;
  onCreateGroup: (name: string) => Promise<boolean>;
}

const NewGroupModal: Component<NewGroupModalProps> = (props) => {
  const [name, setName] = createSignal('');
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

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
      <div class={styles.backdrop} onClick={props.onClose}>
        <div class={styles.modal} onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
          <h3 class={styles.title}>新建分组</h3>
          <form onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              type="text"
              class={styles.input}
              placeholder="输入分组名称"
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
                取消
              </button>
              <button 
                type="submit"
                class={styles.submitButton}
                disabled={!name().trim() || isSubmitting()}
              >
                {isSubmitting() ? '创建中...' : '创建'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
};

export default NewGroupModal;

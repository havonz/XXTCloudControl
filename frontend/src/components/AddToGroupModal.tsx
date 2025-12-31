import { Component, createSignal, For, Show, createEffect } from 'solid-js';
import type { GroupInfo } from '../types';
import styles from './AddToGroupModal.module.css';

interface AddToGroupModalProps {
  open: boolean;
  onClose: () => void;
  groups: GroupInfo[];
  selectedDeviceCount: number;
  onAddToGroup: (groupId: string) => Promise<boolean>;
}

const AddToGroupModal: Component<AddToGroupModalProps> = (props) => {
  const [selectedGroupId, setSelectedGroupId] = createSignal('');
  const [isSubmitting, setIsSubmitting] = createSignal(false);

  // Auto-select first group when modal opens
  createEffect(() => {
    if (props.open && props.groups.length > 0) {
      setSelectedGroupId(props.groups[0].id);
      setIsSubmitting(false);
    } else if (props.open) {
      setSelectedGroupId('');
    }
  });

  const handleSubmit = async () => {
    const groupId = selectedGroupId();
    if (!groupId || isSubmitting()) return;

    setIsSubmitting(true);
    const success = await props.onAddToGroup(groupId);
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
          <h3 class={styles.title}>添加到分组</h3>
          
          <Show when={props.groups.length === 0}>
            <p class={styles.emptyMessage}>暂无可用分组，请先创建分组</p>
          </Show>

          <Show when={props.groups.length > 0}>
            <div class={styles.info}>
              已选择 <strong>{props.selectedDeviceCount}</strong> 台设备
            </div>
            
            <div class={styles.groupSelect}>
              <label class={styles.selectLabel}>选择分组:</label>
              <select
                class={styles.select}
                value={selectedGroupId()}
                onChange={(e) => setSelectedGroupId(e.currentTarget.value)}
                disabled={isSubmitting()}
              >
                <For each={props.groups}>
                  {(group) => (
                    <option value={group.id}>
                      {group.name} ({group.deviceIds?.length || 0} 台)
                    </option>
                  )}
                </For>
              </select>
            </div>
          </Show>

          <div class={styles.actions}>
            <button 
              type="button" 
              class={styles.cancelButton}
              onClick={props.onClose}
              disabled={isSubmitting()}
            >
              取消
            </button>
            <Show when={props.groups.length > 0}>
              <button 
                type="button"
                class={styles.submitButton}
                onClick={handleSubmit}
                disabled={!selectedGroupId() || isSubmitting()}
              >
                {isSubmitting() ? '添加中...' : '添加'}
              </button>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default AddToGroupModal;

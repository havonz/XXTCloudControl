import { Component, createSignal, createMemo, For, Show, createEffect } from 'solid-js';
import { Select, createListCollection } from '@ark-ui/solid';
import { Portal } from 'solid-js/web';
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

  // Create collection for Select component
  const groupCollection = createMemo(() => 
    createListCollection({
      items: props.groups.map(g => ({
        value: g.id,
        label: `${g.name} (${g.deviceIds?.length || 0} 台)`
      }))
    })
  );

  // Get selected group label for display
  const selectedGroupLabel = createMemo(() => {
    const group = props.groups.find(g => g.id === selectedGroupId());
    if (group) {
      return `${group.name} (${group.deviceIds?.length || 0} 台)`;
    }
    return '-- 选择分组 --';
  });

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
              <Select.Root
                collection={groupCollection()}
                value={selectedGroupId() ? [selectedGroupId()] : []}
                onValueChange={(e) => {
                  const next = e.value[0] ?? '';
                  setSelectedGroupId(next);
                }}
                disabled={isSubmitting()}
              >
                <Select.Control>
                  <Select.Trigger class="cbx-select" style={{ width: '100%' }}>
                    <span>{selectedGroupLabel()}</span>
                    <span class="dropdown-arrow">▼</span>
                  </Select.Trigger>
                </Select.Control>
                <Portal>
                  <Select.Positioner style={{ 'z-index': 10200, width: 'var(--reference-width)' }}>
                    <Select.Content class="cbx-panel" style={{ width: 'var(--reference-width)' }}>
                      <Select.ItemGroup>
                        <For each={props.groups}>{(group) => (
                          <Select.Item 
                            item={{ value: group.id, label: `${group.name} (${group.deviceIds?.length || 0} 台)` }} 
                            class="cbx-item"
                          >
                            <div class="cbx-item-content">
                              <Select.ItemIndicator>✓</Select.ItemIndicator>
                              <Select.ItemText>{group.name} ({group.deviceIds?.length || 0} 台)</Select.ItemText>
                            </div>
                          </Select.Item>
                        )}</For>
                      </Select.ItemGroup>
                    </Select.Content>
                  </Select.Positioner>
                </Portal>
              </Select.Root>
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

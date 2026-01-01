import { Component, For, Show, createSignal } from 'solid-js';
import { GroupStoreState } from '../services/GroupStore';
import { useDialog } from './DialogContext';
import styles from './GroupList.module.css';
import { useScriptConfigManager } from '../hooks/useScriptConfigManager';
import { useGroupReorder } from '../hooks/useGroupReorder';
import ScriptConfigModal from './ScriptConfigModal';

interface GroupListProps {
  groupStore: GroupStoreState;
  deviceCount: number;
  onOpenNewGroupModal: () => void;
  onOpenAddToGroupModal: () => void;
  selectedDeviceCount: number;
  onDeviceSelectionChange?: (deviceIds: Set<string>) => void; // 当分组选中改变时同步设备选中
}

const GroupList: Component<GroupListProps> = (props) => {
  const dialog = useDialog();
  const scriptConfigManager = useScriptConfigManager();
  const [showSettings, setShowSettings] = createSignal(false);
  const [contextMenu, setContextMenu] = createSignal<{ x: number; y: number; groupId: string } | null>(null);

  const handleContextMenu = (e: MouseEvent, groupId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, groupId });
  };

  const closeContextMenu = () => setContextMenu(null);

  // 包装 toggleGroupChecked，加上设备选中同步
  const handleToggleGroup = (groupId: string) => {
    props.groupStore.toggleGroupChecked(groupId);
    // 分组选中后，通知父组件更新设备选中
    if (props.onDeviceSelectionChange) {
      const devices = props.groupStore.getDevicesForCheckedGroups();
      props.onDeviceSelectionChange(devices);
    }
  };

  const handleRenameGroup = async () => {
    const menu = contextMenu();
    if (!menu) return;
    closeContextMenu();
    
    const group = props.groupStore.groups().find(g => g.id === menu.groupId);
    if (!group) return;
    
    const newName = await dialog.prompt(`重命名分组 "${group.name}":`, group.name);
    if (newName && newName.trim()) {
      await props.groupStore.renameGroup(menu.groupId, newName.trim());
    }
  };

  const handleDeleteGroup = async () => {
    const menu = contextMenu();
    if (!menu) return;
    closeContextMenu();
    
    const group = props.groupStore.groups().find(g => g.id === menu.groupId);
    if (!group) return;
    
    if (await dialog.confirm(`确定要删除分组 "${group.name}" 吗？`)) {
      await props.groupStore.deleteGroup(menu.groupId);
    }
  };

  const handleRemoveSelectedFromGroup = async () => {
    const menu = contextMenu();
    if (!menu) return;
    closeContextMenu();
    
    // This would need access to selected device IDs - for now just show a placeholder
    await dialog.alert('请先在设备列表中选择要移除的设备，然后使用"从分组移除"功能');
  };

  const handleBindScript = async () => {
    const menu = contextMenu();
    if (!menu) return;
    closeContextMenu();

    const group = props.groupStore.groups().find(g => g.id === menu.groupId);
    if (!group) return;

    const scriptPath = await dialog.prompt(`为分组 "${group.name}" 绑定脚本:`, group.scriptPath || '');
    if (scriptPath !== null) {
      await props.groupStore.bindScriptToGroup(menu.groupId, scriptPath.trim());
    }
  };

  const handleOpenGroupConfig = async () => {
    const menu = contextMenu();
    if (!menu) return;
    closeContextMenu();

    const group = props.groupStore.groups().find(g => g.id === menu.groupId);
    if (!group || !group.scriptPath) {
      if (group && !group.scriptPath) {
        await dialog.alert('请先为该分组绑定脚本');
      }
      return;
    }

    await scriptConfigManager.openGroupConfig(group.id, group.name, group.scriptPath);
  };

  // Set up drag-sort handlers
  const {
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleListDragOver,
    handleListDragLeave,
    handleListDrop,
    handleDragEnd
  } = useGroupReorder({
    groups: props.groupStore.groups,
    setGroups: props.groupStore.setGroups,
    groupSortLocked: props.groupStore.groupSortLocked,
    draggingGroupId: props.groupStore.draggingGroupId,
    setDraggingGroupId: props.groupStore.setDraggingGroupId,
    dragOverGroupId: props.groupStore.dragOverGroupId,
    setDragOverGroupId: props.groupStore.setDragOverGroupId,
    dragOverListEnd: props.groupStore.dragOverListEnd,
    setDragOverListEnd: props.groupStore.setDragOverListEnd,
    reorderGroups: props.groupStore.reorderGroups
  });

  return (
    <div class={styles.groupListContainer}>
      <div class={styles.header}>
        <h3 class={styles.title}>设备分组</h3>
        <div class={styles.headerButtons}>
          <button 
            class={styles.addButton} 
            onClick={props.onOpenNewGroupModal}
            title="新建分组"
          >
            +
          </button>
          <button 
            class={styles.settingsButton}
            onClick={() => setShowSettings(!showSettings())}
            title="分组设置"
          >
            ⚙
          </button>
        </div>
      </div>

      <Show when={showSettings()}>
        <div class={styles.settingsPanel}>
          <label class={styles.settingsOption}>
            <input
              type="checkbox"
              class="themed-checkbox"
              checked={props.groupStore.groupMultiSelect()}
              onChange={(e) => props.groupStore.setGroupMultiSelect(e.currentTarget.checked)}
            />
            <span>允许多选分组</span>
          </label>
          <label class={styles.settingsOption}>
            <input
              type="checkbox"
              class="themed-checkbox"
              checked={props.groupStore.groupSortLocked()}
              onChange={(e) => props.groupStore.setGroupSortLocked(e.currentTarget.checked)}
            />
            <span>锁定排序</span>
          </label>
        </div>
      </Show>

      <ul 
        class={styles.groupList}
        onDragOver={(e) => handleListDragOver(e as DragEvent)}
        onDragLeave={(e) => handleListDragLeave(e as DragEvent)}
        onDrop={(e) => handleListDrop(e as DragEvent)}
      >
        <li 
          class={`${styles.groupItem} ${props.groupStore.checkedGroups().has('__all__') ? styles.checked : ''}`}
          onClick={() => handleToggleGroup('__all__')}
        >
          <div class={styles.groupItemContent}>
            <input
              type="checkbox"
              class={`themed-checkbox ${styles.groupCheckbox}`}
              checked={props.groupStore.checkedGroups().has('__all__')}
              onChange={(e) => {
                e.stopPropagation();
                handleToggleGroup('__all__');
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <div class={styles.groupInfoStack}>
              <span class={styles.groupName}>所有设备</span>
              <span class={styles.groupSubInfo}>{props.deviceCount} 台设备</span>
            </div>
          </div>
        </li>
        
        <For each={props.groupStore.groups()}>
          {(group) => (
            <li 
              class={`${styles.groupItem} ${props.groupStore.checkedGroups().has(group.id) ? styles.checked : ''} ${props.groupStore.draggingGroupId() === group.id ? styles.dragging : ''} ${props.groupStore.dragOverGroupId() === group.id ? styles.dragOver : ''}`}
              draggable={!props.groupStore.groupSortLocked()}
              onClick={() => handleToggleGroup(group.id)}
              onContextMenu={(e) => handleContextMenu(e as unknown as MouseEvent, group.id)}
              onDragStart={(e) => handleDragStart(e as DragEvent, group.id)}
              onDragOver={(e) => handleDragOver(e as DragEvent, group.id)}
              onDragLeave={() => handleDragLeave(group.id)}
              onDrop={(e) => handleDrop(e as DragEvent, group.id)}
              onDragEnd={handleDragEnd}
              style={{
                cursor: props.groupStore.groupSortLocked() ? 'default' : (props.groupStore.draggingGroupId() === group.id ? 'grabbing' : 'grab')
              }}
            >
              <div class={styles.groupItemContent}>
                <input
                  type="checkbox"
                  class={`themed-checkbox ${styles.groupCheckbox}`}
                  checked={props.groupStore.checkedGroups().has(group.id)}
                  onChange={(e) => {
                    e.stopPropagation();
                    handleToggleGroup(group.id);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
                <div class={styles.groupInfoStack}>
                  <span class={styles.groupName}>{group.name}</span>
                  <span class={styles.groupSubInfo}>{group.deviceIds?.length || 0} 台设备</span>
                  <span class={styles.groupSubInfo}>
                    绑定脚本: {group.scriptPath || '未绑定'}
                  </span>
                </div>
              </div>
            </li>
          )}
        </For>
        <Show when={props.groupStore.dragOverListEnd()}>
          <li class={styles.dragOverListEnd} />
        </Show>
      </ul>

      <Show when={props.selectedDeviceCount > 0}>
        <div class={styles.actions}>
          <button 
            class={styles.addToGroupButton}
            onClick={props.onOpenAddToGroupModal}
          >
            添加到分组 ({props.selectedDeviceCount})
          </button>
        </div>
      </Show>

      {/* Context Menu */}
      <Show when={contextMenu()}>
        <div 
          class={styles.contextBackdrop}
          onClick={closeContextMenu}
        />
          <div 
          class={styles.contextMenu}
          style={{ left: `${contextMenu()?.x}px`, top: `${contextMenu()?.y}px` }}
        >
          <button onClick={handleRenameGroup}>重命名分组</button>
          <button onClick={handleBindScript}>绑定脚本</button>
          <button onClick={handleOpenGroupConfig}>分组配置</button>
          <button onClick={handleRemoveSelectedFromGroup}>从分组移除选中设备</button>
          <button onClick={handleDeleteGroup} class={styles.dangerButton}>删除分组</button>
        </div>
      </Show>

      {/* Script Configuration Modal */}
      <ScriptConfigModal
        open={scriptConfigManager.isOpen()}
        title={scriptConfigManager.configTitle()}
        items={scriptConfigManager.uiItems()}
        initialValues={scriptConfigManager.initialValues()}
        scriptInfo={scriptConfigManager.scriptInfo()}
        onClose={scriptConfigManager.closeConfig}
        onSubmit={scriptConfigManager.submitConfig}
      />
    </div>
  );
};

export default GroupList;

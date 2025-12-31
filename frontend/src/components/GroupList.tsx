import { Component, For, Show, createSignal } from 'solid-js';
import { GroupStoreState } from '../services/GroupStore';
import { useDialog } from './DialogContext';
import styles from './GroupList.module.css';
import { useScriptConfigManager } from '../hooks/useScriptConfigManager';
import ScriptConfigModal from './ScriptConfigModal';

interface GroupListProps {
  groupStore: GroupStoreState;
  deviceCount: number;
  onOpenNewGroupModal: () => void;
  onOpenAddToGroupModal: () => void;
  selectedDeviceCount: number;
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
              checked={props.groupStore.groupMultiSelect()}
              onChange={(e) => props.groupStore.setGroupMultiSelect(e.currentTarget.checked)}
            />
            <span>允许多选分组</span>
          </label>
        </div>
      </Show>

      <ul class={styles.groupList}>
        <li 
          class={`${styles.groupItem} ${props.groupStore.checkedGroups().has('__all__') ? styles.checked : ''}`}
          onClick={() => props.groupStore.toggleGroupChecked('__all__')}
        >
          <label class={styles.groupLabel} onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={props.groupStore.checkedGroups().has('__all__')}
              onChange={() => props.groupStore.toggleGroupChecked('__all__')}
            />
            <span class={styles.groupName}>所有设备</span>
          </label>
          <span class={styles.deviceCount}>{props.deviceCount} 台</span>
        </li>
        
        <For each={props.groupStore.groups()}>
          {(group) => (
            <li 
              class={`${styles.groupItem} ${props.groupStore.checkedGroups().has(group.id) ? styles.checked : ''}`}
              onClick={() => props.groupStore.toggleGroupChecked(group.id)}
              onContextMenu={(e) => handleContextMenu(e as unknown as MouseEvent, group.id)}
            >
              <label class={styles.groupLabel} onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={props.groupStore.checkedGroups().has(group.id)}
                  onChange={() => props.groupStore.toggleGroupChecked(group.id)}
                />
                <span class={styles.groupName}>{group.name}</span>
                <Show when={group.scriptPath}>
                  <span class={styles.groupScript} title={`已绑定脚本: ${group.scriptPath}`}>
                    ({group.scriptPath})
                  </span>
                </Show>
              </label>
              <span class={styles.deviceCount}>{group.deviceIds?.length || 0} 台</span>
            </li>
          )}
        </For>
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

import { Component, For, Show, createSignal } from 'solid-js';
import { GroupStoreState } from '../services/GroupStore';
import { Device } from '../services/WebSocketService';
import { useDialog } from './DialogContext';
import styles from './GroupList.module.css';
import { useScriptConfigManager } from '../hooks/useScriptConfigManager';
import { useGroupReorder } from '../hooks/useGroupReorder';
import ScriptConfigModal from './ScriptConfigModal';
import { authFetch } from '../services/httpAuth';
import ContextMenu, { ContextMenuButton } from './ContextMenu';
import { useI18n } from '../i18n';

interface GroupListProps {
  groupStore: GroupStoreState;
  deviceCount: number;
  allDevices?: Device[];
  onOpenNewGroupModal: () => void;
  onDeviceSelectionChange?: (deviceIds: Set<string>) => void; // 当分组选中改变时同步设备选中
}

const GroupList: Component<GroupListProps> = (props) => {
  const dialog = useDialog();
  const { t } = useI18n();
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
    const isMultiSelect = props.groupStore.groupMultiSelect();
    props.groupStore.toggleGroupChecked(groupId);
    
    // 分组选中后，通知父组件更新设备选中
    if (props.onDeviceSelectionChange) {
      // In multi-select mode, toggling "所有设备" doesn't affect device selection
      if (isMultiSelect && groupId === '__all__') {
        return; // Skip device selection update
      }
      
      const allDeviceIds = props.allDevices?.map(d => d.udid) || [];
      const devices = props.groupStore.getDevicesForCheckedGroups(allDeviceIds);
      props.onDeviceSelectionChange(devices);
    }
  };

  const handleRenameGroup = async () => {
    const menu = contextMenu();
    if (!menu) return;
    closeContextMenu();
    
    const group = props.groupStore.groups().find(g => g.id === menu.groupId);
    if (!group) return;
    
    const newName = await dialog.prompt(t('group.rename_prompt', { name: group.name }), group.name);
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
    
    if (await dialog.confirm(t('group.delete_confirm', { name: group.name }))) {
      await props.groupStore.deleteGroup(menu.groupId);
    }
  };

  const fetchSelectableScripts = async () => {
    try {
      const response = await authFetch('/api/scripts/selectable');
      const data = await response.json();
      return data.scripts || [];
    } catch (error) {
      console.error(t('group.fetch_scripts_failed'), error);
      return [];
    }
  };

  const handleBindScript = async () => {
    const menu = contextMenu();
    if (!menu) return;
    closeContextMenu();

    const group = props.groupStore.groups().find(g => g.id === menu.groupId);
    if (!group) return;

    // Placeholder options for group binding
    const NO_BINDING_PLACEHOLDER = t('group.not_bound_global');
    const DEVICE_SELECTED_PLACEHOLDER = t('group.device_selected_script');
    
    const serverScripts = await fetchSelectableScripts();
    // Prepend placeholder options
    const scripts = [NO_BINDING_PLACEHOLDER, DEVICE_SELECTED_PLACEHOLDER, ...serverScripts];
    
    // Map stored value back to display value for default selection
    let defaultValue = group.scriptPath || '';
    if (defaultValue === '') {
      defaultValue = NO_BINDING_PLACEHOLDER;
    } else if (defaultValue === '<设备端已选中>') {
      defaultValue = DEVICE_SELECTED_PLACEHOLDER;
    }

    const selectedValue = await dialog.select(
      t('group.bind_script_prompt', { name: group.name }),
      scripts,
      defaultValue,
      t('group.bind_script_title')
    );

    if (selectedValue !== null && selectedValue !== undefined) {
      // Convert placeholder to stored value
      let scriptPath = selectedValue.trim();
      if (scriptPath === NO_BINDING_PLACEHOLDER) {
        scriptPath = ''; // Empty means follow global selection
      } else if (scriptPath === DEVICE_SELECTED_PLACEHOLDER) {
        scriptPath = '<设备端已选中>';
      }
      // DEVICE_SELECTED_PLACEHOLDER stays as-is for display, backend will handle it
      
      await props.groupStore.bindScriptToGroup(menu.groupId, scriptPath);
    }
  };

  const handleOpenGroupConfig = async () => {
    const menu = contextMenu();
    if (!menu) return;
    closeContextMenu();

    const group = props.groupStore.groups().find(g => g.id === menu.groupId);
    if (!group || !group.scriptPath) {
      if (group && !group.scriptPath) {
        await dialog.alert(t('group.bind_script_first'));
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
        <h3 class={styles.title}>{t('group.title')}</h3>
        <div class={styles.headerButtons}>
          <button 
            class={styles.addButton} 
            onClick={props.onOpenNewGroupModal}
            title={t('group.new_title')}
          >
            +
          </button>
          <button 
            class={styles.settingsButton}
            onClick={() => setShowSettings(!showSettings())}
            title={t('group.settings')}
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
            <span>{t('group.allow_multi_select')}</span>
          </label>
          <label class={styles.settingsOption}>
            <input
              type="checkbox"
              class="themed-checkbox"
              checked={props.groupStore.groupSortLocked()}
              onChange={(e) => props.groupStore.setGroupSortLocked(e.currentTarget.checked)}
            />
            <span>{t('group.lock_sort')}</span>
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
              <span class={styles.groupName}>{t('group.all_devices')}</span>
              <span class={styles.groupSubInfo}>{t('group.device_count', { count: props.deviceCount })}</span>
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
                  <span class={styles.groupSubInfo}>{t('group.device_count', { count: group.deviceIds?.length || 0 })}</span>
                  <span class={styles.groupSubInfo}>
                    {t('group.bound_script', { script: group.scriptPath === '<设备端已选中>' ? t('group.device_selected_script') : (group.scriptPath || '-') })}
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



      {/* Context Menu */}
      <ContextMenu
        isOpen={!!contextMenu()}
        position={{ x: contextMenu()?.x || 0, y: contextMenu()?.y || 0 }}
        onClose={closeContextMenu}
      >
        <>
          <ContextMenuButton onClick={handleRenameGroup}>{t('group.menu_rename')}</ContextMenuButton>
          <ContextMenuButton onClick={handleBindScript}>{t('group.menu_bind_script')}</ContextMenuButton>
          <ContextMenuButton onClick={handleOpenGroupConfig}>{t('group.menu_config')}</ContextMenuButton>
          <ContextMenuButton onClick={handleDeleteGroup} danger>{t('group.menu_delete')}</ContextMenuButton>
        </>
      </ContextMenu>

      {/* Script Configuration Modal */}
      <ScriptConfigModal
        open={scriptConfigManager.isOpen()}
        title={scriptConfigManager.configTitle()}
        items={scriptConfigManager.uiItems()}
        initialValues={scriptConfigManager.initialValues()}
        scriptInfo={scriptConfigManager.scriptInfo()}
        submitLabel={scriptConfigManager.submitLabel()}
        validateOnOpen={scriptConfigManager.validateOnOpen()}
        onClose={scriptConfigManager.closeConfig}
        onSubmit={scriptConfigManager.submitConfig}
      />
    </div>
  );
};

export default GroupList;

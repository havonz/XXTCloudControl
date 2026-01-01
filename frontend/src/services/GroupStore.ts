import { createSignal, createMemo, Accessor, Setter } from 'solid-js';
import type { GroupInfo } from '../types';
import { authFetch } from './httpAuth';

// API functions for group operations
const api = async (url: string, options?: RequestInit) => {
  const response = await authFetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return response.json();
};

export interface GroupStoreState {
  groups: Accessor<GroupInfo[]>;
  setGroups: Setter<GroupInfo[]>;
  checkedGroups: Accessor<Set<string>>;
  setCheckedGroups: Setter<Set<string>>;
  groupMultiSelect: Accessor<boolean>;
  setGroupMultiSelect: (value: boolean) => void;
  visibleDeviceIds: Accessor<Set<string> | null>;
  
  // Drag-sort state
  draggingGroupId: Accessor<string>;
  setDraggingGroupId: Setter<string>;
  dragOverGroupId: Accessor<string>;
  setDragOverGroupId: Setter<string>;
  dragOverListEnd: Accessor<boolean>;
  setDragOverListEnd: Setter<boolean>;
  groupSortLocked: Accessor<boolean>;
  setGroupSortLocked: Setter<boolean>;
  
  // Actions
  loadGroups: () => Promise<void>;
  createGroup: (name: string) => Promise<boolean>;
  renameGroup: (groupId: string, name: string) => Promise<boolean>;
  deleteGroup: (groupId: string) => Promise<boolean>;
  addDevicesToGroup: (groupId: string, deviceIds: string[]) => Promise<boolean>;
  removeDevicesFromGroup: (groupId: string, deviceIds: string[]) => Promise<boolean>;
  toggleGroupChecked: (groupId: string) => void;
  bindScriptToGroup: (groupId: string, scriptPath: string) => Promise<boolean>;
  reorderGroups: (order: string[]) => Promise<boolean>;
  // 获取选中分组的绑定脚本信息
  getPreferredGroupScript: () => { scriptPath: string; groupId: string } | null;
  // 返回需要选中的设备ID列表
  getDevicesForCheckedGroups: () => Set<string>;
  // 获取按分组分配的设备列表（用于分组启动）
  getGroupedDevicesForLaunch: (selectedDeviceIds: string[]) => GroupLaunchInfo[];
}

// 分组启动信息
export type GroupLaunchInfo = {
  groupId: string;
  groupName: string;
  scriptPath: string | undefined;
  deviceIds: string[];
};

export function createGroupStore(): GroupStoreState {
  const [groups, setGroups] = createSignal<GroupInfo[]>([]);
  const [checkedGroups, setCheckedGroups] = createSignal<Set<string>>(new Set(['__all__']));
  const [groupMultiSelect, setGroupMultiSelectVal] = createSignal(false); // Default: 不允许多选分组
  
  // Drag-sort state signals
  const [draggingGroupId, setDraggingGroupId] = createSignal<string>('');
  const [dragOverGroupId, setDragOverGroupId] = createSignal<string>('');
  const [dragOverListEnd, setDragOverListEnd] = createSignal(false);
  const [groupSortLocked, setGroupSortLocked] = createSignal(false); // Default: 不锁定排序

  // Compute visible device IDs based on checked groups
  const visibleDeviceIds = createMemo<Set<string> | null>(() => {
    const checked = checkedGroups();
    if (checked.has('__all__')) return null; // Show all devices
    
    const result = new Set<string>();
    const groupList = groups();
    
    for (const gid of checked) {
      if (gid === '__all__') continue;
      const group = groupList.find(g => g.id === gid);
      if (group?.deviceIds) {
        for (const deviceId of group.deviceIds) {
          if (deviceId) result.add(deviceId);
        }
      }
    }
    return result;
  });

  // Get devices that should be selected based on checked groups
  const getDevicesForCheckedGroups = (): Set<string> => {
    const checked = checkedGroups();
    if (checked.has('__all__')) return new Set<string>(); // Empty means "use existing selection"
    
    const result = new Set<string>();
    const groupList = groups();
    
    for (const gid of checked) {
      if (gid === '__all__') continue;
      const group = groupList.find(g => g.id === gid);
      if (group?.deviceIds) {
        for (const deviceId of group.deviceIds) {
          if (deviceId) result.add(deviceId);
        }
      }
    }
    return result;
  };

  // Get the first checked group's bound script (by sortOrder)
  const getPreferredGroupScript = (): { scriptPath: string; groupId: string } | null => {
    const checked = checkedGroups();
    if (checked.has('__all__')) return null;
    
    // Groups are already sorted by sortOrder
    const groupList = groups();
    for (const group of groupList) {
      if (checked.has(group.id) && group.scriptPath?.trim()) {
        return { scriptPath: group.scriptPath.trim(), groupId: group.id };
      }
    }
    return null;
  };

  // 获取按分组分配的设备列表（用于分组启动）
  // 规则：
  // 1. 如果选中“所有设备”，返回空数组（使用全局配置）
  // 2. 按分组 sortOrder 排序，每个设备只分配给第一个包含它的被选中分组
  // 3. 返回每个分组及其分配到的设备列表
  const getGroupedDevicesForLaunch = (selectedDeviceIds: string[]): GroupLaunchInfo[] => {
    const checked = checkedGroups();
    if (checked.has('__all__')) return []; // 使用全局配置
    
    const selectedSet = new Set(selectedDeviceIds);
    const assignedDevices = new Set<string>(); // 跟踪已分配设备
    const result: GroupLaunchInfo[] = [];
    
    // 分组已按 sortOrder 排序
    const groupList = groups();
    
    for (const group of groupList) {
      if (!checked.has(group.id)) continue;
      
      // 收集属于该分组且未被分配的设备
      const groupDevices: string[] = [];
      for (const deviceId of group.deviceIds || []) {
        if (deviceId && selectedSet.has(deviceId) && !assignedDevices.has(deviceId)) {
          groupDevices.push(deviceId);
          assignedDevices.add(deviceId);
        }
      }
      
      // 只有有设备成员才加入结果
      if (groupDevices.length > 0) {
        result.push({
          groupId: group.id,
          groupName: group.name,
          scriptPath: group.scriptPath?.trim() || undefined,
          deviceIds: groupDevices
        });
      }
    }
    
    return result;
  };

  // Load groups from server
  const loadGroups = async () => {
    try {
      const data = await api('/api/groups');
      if (data.groups && Array.isArray(data.groups)) {
        setGroups(data.groups);
      }
    } catch (error) {
      console.error('Failed to load groups:', error);
    }
  };

  // Create a new group
  const createGroup = async (name: string): Promise<boolean> => {
    try {
      const data = await api('/api/groups', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      if (data.success) {
        await loadGroups();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to create group:', error);
      return false;
    }
  };

  // Rename a group
  const renameGroup = async (groupId: string, name: string): Promise<boolean> => {
    try {
      const data = await api(`/api/groups/${groupId}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      });
      if (data.success) {
        await loadGroups();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to rename group:', error);
      return false;
    }
  };

  // Delete a group
  const deleteGroup = async (groupId: string): Promise<boolean> => {
    try {
      const data = await api(`/api/groups/${groupId}`, {
        method: 'DELETE',
      });
      if (data.success) {
        // Remove from checked groups if needed
        const newChecked = new Set(checkedGroups());
        newChecked.delete(groupId);
        if (newChecked.size === 0) newChecked.add('__all__');
        setCheckedGroups(newChecked);
        await loadGroups();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to delete group:', error);
      return false;
    }
  };

  // Add devices to a group
  const addDevicesToGroup = async (groupId: string, deviceIds: string[]): Promise<boolean> => {
    try {
      const data = await api(`/api/groups/${groupId}/devices`, {
        method: 'POST',
        body: JSON.stringify({ deviceIds }),
      });
      if (data.success) {
        await loadGroups();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to add devices to group:', error);
      return false;
    }
  };

  // Remove devices from a group
  const removeDevicesFromGroup = async (groupId: string, deviceIds: string[]): Promise<boolean> => {
    try {
      const data = await api(`/api/groups/${groupId}/devices`, {
        method: 'DELETE',
        body: JSON.stringify({ deviceIds }),
      });
      if (data.success) {
        await loadGroups();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to remove devices from group:', error);
      return false;
    }
  };

  // Toggle group checked state
  const toggleGroupChecked = (groupId: string) => {
    const prev = new Set(checkedGroups());
    let next: Set<string>;

    if (groupMultiSelect()) {
      next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      // If unchecking __all__, we should keep at least one group
      if (next.size === 0) next.add('__all__');
      // If checking a specific group while __all__ is checked, remove __all__
      if (groupId !== '__all__' && next.has('__all__') && next.size > 1) {
        next.delete('__all__');
      }
      // If checking __all__, clear all specific group selections
      if (groupId === '__all__') {
        next = new Set(['__all__']);
      }
    } else {
      // Single select mode
      if (groupId === '__all__') {
        next = new Set(['__all__']);
      } else {
        const onlyThisSelected = prev.size === 1 && prev.has(groupId);
        next = onlyThisSelected ? new Set(['__all__']) : new Set([groupId]);
      }
    }
    setCheckedGroups(next);
  };

  const setGroupMultiSelect = (value: boolean) => {
    const prev = groupMultiSelect();
    if (prev === value) return;
    
    setGroupMultiSelectVal(value);
    
    // If disabling multi-select, reset to __all__ if multiple selected
    if (!value) {
      const checked = Array.from(checkedGroups()).filter(id => id !== '__all__');
      if (checked.length > 1) {
        setCheckedGroups(new Set(['__all__']));
      } else if (checked.length === 1) {
        setCheckedGroups(new Set([checked[0]]));
      } else {
        setCheckedGroups(new Set(['__all__']));
      }
    }
  };

  const bindScriptToGroup = async (groupId: string, scriptPath: string): Promise<boolean> => {
    try {
      const data = await api(`/api/groups/${groupId}/script`, {
        method: 'PUT',
        body: JSON.stringify({ scriptPath }),
      });
      if (data.success) {
        await loadGroups();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to bind script to group:', error);
      return false;
    }
  };

  const reorderGroups = async (order: string[]): Promise<boolean> => {
    try {
      const data = await api('/api/groups/reorder', {
        method: 'PUT',
        body: JSON.stringify({ order }),
      });
      return data.success === true;
    } catch (error) {
      console.error('Failed to reorder groups:', error);
      return false;
    }
  };

  return {
    groups,
    setGroups,
    checkedGroups,
    setCheckedGroups,
    groupMultiSelect,
    setGroupMultiSelect,
    visibleDeviceIds,
    draggingGroupId,
    setDraggingGroupId,
    dragOverGroupId,
    setDragOverGroupId,
    dragOverListEnd,
    setDragOverListEnd,
    groupSortLocked,
    setGroupSortLocked,
    loadGroups,
    createGroup,
    renameGroup,
    deleteGroup,
    addDevicesToGroup,
    removeDevicesFromGroup,
    toggleGroupChecked,
    bindScriptToGroup,
    reorderGroups,
    getPreferredGroupScript,
    getDevicesForCheckedGroups,
    getGroupedDevicesForLaunch,
  };
}

import { createSignal, createMemo, Accessor, Setter } from 'solid-js';
import type { GroupInfo } from '../types';

// API functions for group operations
const api = async (url: string, options?: RequestInit) => {
  const response = await fetch(url, {
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
  
  // Actions
  loadGroups: () => Promise<void>;
  createGroup: (name: string) => Promise<boolean>;
  renameGroup: (groupId: string, name: string) => Promise<boolean>;
  deleteGroup: (groupId: string) => Promise<boolean>;
  addDevicesToGroup: (groupId: string, deviceIds: string[]) => Promise<boolean>;
  removeDevicesFromGroup: (groupId: string, deviceIds: string[]) => Promise<boolean>;
  toggleGroupChecked: (groupId: string) => void;
  bindScriptToGroup: (groupId: string, scriptPath: string) => Promise<boolean>;
}

export function createGroupStore(): GroupStoreState {
  const [groups, setGroups] = createSignal<GroupInfo[]>([]);
  const [checkedGroups, setCheckedGroups] = createSignal<Set<string>>(new Set(['__all__']));
  const [groupMultiSelect, setGroupMultiSelectVal] = createSignal(true);

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

  return {
    groups,
    setGroups,
    checkedGroups,
    setCheckedGroups,
    groupMultiSelect,
    setGroupMultiSelect,
    visibleDeviceIds,
    loadGroups,
    createGroup,
    renameGroup,
    deleteGroup,
    addDevicesToGroup,
    removeDevicesFromGroup,
    toggleGroupChecked,
    bindScriptToGroup,
  };
}

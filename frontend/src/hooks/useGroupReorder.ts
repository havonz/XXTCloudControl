import type { Accessor, Setter } from 'solid-js';
import type { GroupInfo } from '../types';

type UseGroupReorderOptions = {
  groups: Accessor<GroupInfo[]>;
  setGroups: Setter<GroupInfo[]>;
  groupSortLocked: Accessor<boolean>;
  draggingGroupId: Accessor<string>;
  setDraggingGroupId: Setter<string>;
  dragOverGroupId: Accessor<string>;
  setDragOverGroupId: Setter<string>;
  dragOverListEnd: Accessor<boolean>;
  setDragOverListEnd: Setter<boolean>;
  reorderGroups: (order: string[]) => Promise<boolean>;
};

type UseGroupReorderResult = {
  handleDragStart: (event: DragEvent, groupId: string) => void;
  handleDragOver: (event: DragEvent, targetId: string) => void;
  handleDragLeave: (targetId: string) => void;
  handleDrop: (event: DragEvent, targetId: string) => Promise<void>;
  handleListDragOver: (event: DragEvent) => void;
  handleListDragLeave: (event: DragEvent) => void;
  handleListDrop: (event: DragEvent) => Promise<void>;
  handleDragEnd: () => void;
};

export function useGroupReorder(options: UseGroupReorderOptions): UseGroupReorderResult {
  const resetDragState = () => {
    options.setDraggingGroupId('');
    options.setDragOverGroupId('');
    options.setDragOverListEnd(false);
  };

  const persistGroupOrder = async (nextOrder: GroupInfo[]) => {
    if (options.groupSortLocked()) return;
    const ordered = nextOrder.map((group, index) => ({ ...group, sortOrder: index }));
    options.setGroups(ordered);
    await options.reorderGroups(ordered.map(g => g.id));
  };

  const handleDragStart = (event: DragEvent, groupId: string) => {
    if (options.groupSortLocked()) {
      event.preventDefault();
      return;
    }
    options.setDraggingGroupId(groupId);
    options.setDragOverGroupId('');
    options.setDragOverListEnd(false);
    try {
      event.dataTransfer?.setData('text/plain', groupId);
      event.dataTransfer?.setDragImage?.(event.currentTarget as Element, 0, 0);
    } catch {
      /* 忽略 dragImage 设置失败 */
    }
  };

  const handleDragOver = (event: DragEvent, targetId: string) => {
    if (options.groupSortLocked()) return;
    const sourceId = options.draggingGroupId();
    if (!sourceId || sourceId === targetId) return;
    event.preventDefault();
    event.stopPropagation();
    options.setDragOverGroupId(targetId);
    options.setDragOverListEnd(false);
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  };

  const handleDragLeave = (targetId: string) => {
    if (options.dragOverGroupId() === targetId) {
      options.setDragOverGroupId('');
    }
    options.setDragOverListEnd(false);
  };

  const handleDrop = async (event: DragEvent, targetId: string) => {
    if (options.groupSortLocked()) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceId = options.draggingGroupId();
    resetDragState();
    if (!sourceId || sourceId === targetId) return;
    const list = options.groups().slice();
    const fromIndex = list.findIndex(group => group.id === sourceId);
    if (fromIndex === -1) return;
    const [moved] = list.splice(fromIndex, 1);
    const insertIndex = (() => {
      const index = list.findIndex(group => group.id === targetId);
      return index === -1 ? list.length : index;
    })();
    list.splice(insertIndex, 0, moved);
    await persistGroupOrder(list);
  };

  const handleListDrop = async (event: DragEvent) => {
    if (options.groupSortLocked()) return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceId = options.draggingGroupId();
    resetDragState();
    if (!sourceId) return;
    const list = options.groups().slice();
    const fromIndex = list.findIndex(group => group.id === sourceId);
    if (fromIndex === -1) return;
    const [moved] = list.splice(fromIndex, 1);
    list.push(moved);
    await persistGroupOrder(list);
  };

  const handleListDragOver = (event: DragEvent) => {
    if (options.groupSortLocked()) return;
    if (!options.draggingGroupId()) return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    options.setDragOverGroupId('');
    options.setDragOverListEnd(true);
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  };

  const handleListDragLeave = (event: DragEvent) => {
    if (event.target === event.currentTarget) {
      options.setDragOverListEnd(false);
    }
  };

  const handleDragEnd = () => {
    resetDragState();
  };

  return {
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleListDragOver,
    handleListDragLeave,
    handleListDrop,
    handleDragEnd
  };
}

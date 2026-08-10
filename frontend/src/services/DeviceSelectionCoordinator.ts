export interface PendingGroupRemovalSelection {
  manualRevisionByUdid: Map<string, number>;
}

export function createDeviceSelectionCoordinator() {
  let selectionIntentRevision = 0;
  let lastGroupSelectionRevision = 0;
  const pendingGroupRemovals = new Set<PendingGroupRemovalSelection>();

  const beginGroupRemoval = (): PendingGroupRemovalSelection => {
    const pending = { manualRevisionByUdid: new Map<string, number>() };
    pendingGroupRemovals.add(pending);
    return pending;
  };

  const finishGroupRemoval = (pending: PendingGroupRemovalSelection) => {
    pendingGroupRemovals.delete(pending);
  };

  const recordManualSelection = (touchedDeviceIds: readonly string[]) => {
    const revision = ++selectionIntentRevision;
    for (const pending of pendingGroupRemovals) {
      for (const udid of touchedDeviceIds) {
        pending.manualRevisionByUdid.set(udid, revision);
      }
    }
  };

  const recordGroupSelection = () => {
    lastGroupSelectionRevision = ++selectionIntentRevision;
  };

  const shouldPreserveManualSelection = (pending: PendingGroupRemovalSelection, udid: string): boolean => (
    (pending.manualRevisionByUdid.get(udid) || 0) > lastGroupSelectionRevision
  );

  return {
    beginGroupRemoval,
    finishGroupRemoval,
    recordManualSelection,
    recordGroupSelection,
    shouldPreserveManualSelection,
  };
}

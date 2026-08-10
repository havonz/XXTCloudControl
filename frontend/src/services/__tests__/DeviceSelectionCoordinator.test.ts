import { describe, expect, it } from 'vitest';
import { createDeviceSelectionCoordinator } from '../DeviceSelectionCoordinator';

describe('DeviceSelectionCoordinator', () => {
  it('保留移除期间用户明确触及的设备选择', () => {
    const coordinator = createDeviceSelectionCoordinator();
    const pending = coordinator.beginGroupRemoval();

    coordinator.recordManualSelection(['device-a']);

    expect(coordinator.shouldPreserveManualSelection(pending, 'device-a')).toBe(true);
    expect(coordinator.shouldPreserveManualSelection(pending, 'device-b')).toBe(false);
  });

  it('后发生的分组选择覆盖更早的手动选择', () => {
    const coordinator = createDeviceSelectionCoordinator();
    const pending = coordinator.beginGroupRemoval();

    coordinator.recordManualSelection(['device-a']);
    coordinator.recordGroupSelection();

    expect(coordinator.shouldPreserveManualSelection(pending, 'device-a')).toBe(false);
  });

  it('分组选择之后的手动选择保持优先', () => {
    const coordinator = createDeviceSelectionCoordinator();
    const pending = coordinator.beginGroupRemoval();

    coordinator.recordGroupSelection();
    coordinator.recordManualSelection(['device-a']);

    expect(coordinator.shouldPreserveManualSelection(pending, 'device-a')).toBe(true);
  });

  it('完成的移除操作不再记录后续选择', () => {
    const coordinator = createDeviceSelectionCoordinator();
    const pending = coordinator.beginGroupRemoval();
    coordinator.finishGroupRemoval(pending);

    coordinator.recordManualSelection(['device-a']);

    expect(coordinator.shouldPreserveManualSelection(pending, 'device-a')).toBe(false);
  });
});

import { PendingRuntimeChange, RuntimeStatus, RuntimeSettingsError } from './runtimeSettingsProtocol';

export type RuntimeOperation = PendingRuntimeChange & { state: 'submitting' | 'submitted' | 'failed'; error?: string };
export interface RuntimeSettingsAdapter {
  read: (id: string) => Promise<RuntimeStatus>;
  apply: (id: string, request: PendingRuntimeChange['request']) => void | Promise<void>;
}
export class RuntimeSettingsService {
  private operations = new Map<string, RuntimeOperation>();
  private listeners = new Set<() => void>();
  constructor(private adapter: RuntimeSettingsAdapter) {}
  read(id: string): Promise<RuntimeStatus> { return this.adapter.read(id); }
  get(id: string): RuntimeOperation | undefined { return this.operations.get(id); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  dispose(): void { this.listeners.clear(); }
  async submit(change: PendingRuntimeChange): Promise<void> {
    if (this.operations.get(change.deviceId)?.state === 'submitting') throw new RuntimeSettingsError('rejected', 'Device settings are being updated.');
    const operation: RuntimeOperation = { ...change, state: 'submitting' };
    this.operations.set(change.deviceId, operation);
    this.listeners.forEach(listener => listener());
    try {
      await this.adapter.apply(change.deviceId, change.request);
      operation.state = 'submitted';
    } catch (error) {
      operation.state = 'failed'; operation.error = error instanceof Error ? error.message : String(error);
    }
    this.listeners.forEach(listener => listener());
  }
}

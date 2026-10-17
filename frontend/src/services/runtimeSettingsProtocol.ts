export const runtimePortKeys = ['port', 'udp_port', 'webdav_port', 'log_port'] as const;
export type RuntimePorts = Record<typeof runtimePortKeys[number], number>;

export interface RuntimeStatus {
    ok: true;
    deviceid?: string;
    ready: boolean;
    busy?: boolean;
    blocks_writes?: boolean;
    revision: number;
    profile_generation: number;
    document_path: string;
    configuration_path: string;
    active: RuntimePorts;
    bound?: RuntimePorts;
    configured?: RuntimePorts;
    pending?: RuntimePorts;
    transaction_id?: string;
    last_error?: string;
    last_result?: { transaction_id?: string; revision?: number; phase?: string; error?: string };
    operation_status?: { transaction_id?: string; revision?: number; phase?: string; error?: string; rollback_error?: string };
    _physical?: { document_path?: string };
}

export interface RuntimeApplyRequest {
    settings: RuntimePorts;
    expected_revision: number;
    use_device_directory?: true;
    prepare_downgrade?: true;
}

export interface PendingRuntimeChange {
    deviceId: string;
    request: RuntimeApplyRequest;
    profileGeneration: number;
}

export class RuntimeSettingsError extends Error {
    constructor(public readonly reason: 'unsupported' | 'rejected' | 'invalid' | 'connection', message: string) {
        super(message);
        this.name = 'RuntimeSettingsError';
    }
}

export function decodeRuntimeResponse(status: number, body: any): any {
    if (status === 404 || status === 405 || status === 501) {
        throw new RuntimeSettingsError('unsupported', 'Runtime settings are not supported by this device.');
    }
    if (status < 200 || status >= 300 || body?.ok !== true) {
        throw new RuntimeSettingsError(body?.ok === false ? 'rejected' : 'connection',
            typeof body?.error === 'string' ? body.error : `HTTP ${status}`);
    }
    return body;
}

export function validateRuntimePorts(ports: RuntimePorts): boolean {
    return runtimePortKeys.every(key => Number.isInteger(ports[key]) &&
        ((key !== 'port' && ports[key] === 0) || (ports[key] >= 10000 && ports[key] <= 65535))) &&
        new Set([ports.port, ports.webdav_port, ports.log_port].filter(Boolean)).size ===
        [ports.port, ports.webdav_port, ports.log_port].filter(Boolean).length;
}

export function parseRuntimeStatus(body: any): RuntimeStatus {
    if (body?.ok !== true || !Number.isSafeInteger(body.revision) || body.revision < 0 ||
        ![1, 2].includes(body.profile_generation) || typeof body.document_path !== 'string' ||
        typeof body.configuration_path !== 'string' || typeof body.ready !== 'boolean' ||
        !body.active || !runtimePortKeys.every(key => Number.isInteger(body.active[key]))) {
        throw new RuntimeSettingsError('invalid', 'Invalid runtime settings response.');
    }
    return body;
}

export function isRuntimeSettingsEditable(status: RuntimeStatus): boolean {
    return !status.busy && !status.blocks_writes && (status.ready ||
        [status.operation_status, status.last_result].some(result => result && ['failed', 'rolled_back'].includes(result.phase || '')));
}

export function prepareRuntimeChange(deviceId: string, before: RuntimeStatus,
    patch: Partial<RuntimePorts> & { deviceDirectory?: boolean }): PendingRuntimeChange {
    if (!isRuntimeSettingsEditable(before)) {
        throw new RuntimeSettingsError('rejected', 'Device settings are not ready.');
    }
    const settings = { ...before.active };
    for (const key of runtimePortKeys) {
        if (patch[key] !== undefined) settings[key] = patch[key]!;
    }
    if (!validateRuntimePorts(settings)) {
        throw new RuntimeSettingsError('invalid', 'Invalid ports or duplicate TCP ports.');
    }
    const request: RuntimeApplyRequest = { settings, expected_revision: before.revision };
    const profileGeneration = patch.deviceDirectory === undefined ? before.profile_generation : patch.deviceDirectory ? 2 : 1;
    if (profileGeneration !== before.profile_generation) {
        if (profileGeneration === 2) request.use_device_directory = true;
        else request.prepare_downgrade = true;
    }
    return { deviceId, request, profileGeneration };
}

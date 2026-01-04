/**
 * GateManagerProvider
 *
 * Bridges GateManager/registry-backed guides to the legacy gate loader contract.
 * Converts IGateGuide definitions into the LightweightGateDefinition shape used
 * by existing pipeline stages without duplicating loading logic.
 *
 * Temporary gates can be merged via TemporaryGateRegistry when provided.
 */
import type { GateDefinitionProvider } from '../core/gate-loader.js';
import type { TemporaryGateRegistry } from '../core/temporary-gate-registry.js';
import type { GateManager } from '../gate-manager.js';
import type { GateActivationResult, LightweightGateDefinition } from '../types.js';
export declare class GateManagerProvider implements GateDefinitionProvider {
    private readonly gateManager;
    private readonly temporaryGateRegistry;
    constructor(gateManager: GateManager, temporaryGateRegistry?: TemporaryGateRegistry);
    loadGate(gateId: string): Promise<LightweightGateDefinition | null>;
    loadGates(gateIds: string[]): Promise<LightweightGateDefinition[]>;
    getActiveGates(gateIds: string[], context: {
        promptCategory?: string;
        framework?: string;
        explicitRequest?: boolean;
    }): Promise<GateActivationResult>;
    listAvailableGates(): Promise<string[]>;
    listAvailableGateDefinitions(): Promise<LightweightGateDefinition[]>;
    clearCache(): void;
    isGateActive(gate: LightweightGateDefinition, context: {
        promptCategory?: string;
        framework?: string;
        explicitRequest?: boolean;
    }): boolean;
    getStatistics(): {
        cachedGates: number;
        totalLoads: number;
        lastAccess: Date | null;
    };
    isMethodologyGate(gateId: string): Promise<boolean>;
    isMethodologyGateCached(gateId: string): boolean;
    getMethodologyGateIds(): Promise<string[]>;
    private toLightweight;
    private normalizeRetryConfig;
}

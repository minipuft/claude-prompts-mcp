// @lifecycle canonical - Adapter that exposes GateManager through the GateDefinitionProvider contract.
/**
 * GateManagerProvider
 *
 * Bridges GateManager/registry-backed guides to the legacy gate loader contract.
 * Converts GateGuide definitions into the LightweightGateDefinition shape used
 * by existing pipeline stages without duplicating loading logic.
 *
 * Temporary gates can be merged via TemporaryGateRegistry when provided.
 */

import { isGateActiveForContext } from '../utils/gate-activation.js';

import type { GateDefinitionProvider } from '../core/gate-loader.js';
import type { TemporaryGateRegistry } from '../core/temporary-gate-registry.js';
import type {
  IGateManager,
  GateActivationContext,
  GateActivationResult,
  LoadedGateDefinition,
  LightweightGateDefinition,
} from '../types.js';

export class GateManagerProvider implements GateDefinitionProvider {
  private readonly gateManager: IGateManager;
  private readonly temporaryGateRegistry: TemporaryGateRegistry | undefined;

  constructor(gateManager: IGateManager, temporaryGateRegistry?: TemporaryGateRegistry) {
    this.gateManager = gateManager;
    this.temporaryGateRegistry = temporaryGateRegistry;
  }

  async loadGate(gateId: string): Promise<LightweightGateDefinition | null> {
    const tempGate = this.temporaryGateRegistry?.getTemporaryGate(gateId);
    if (tempGate) {
      const lightweight = this.temporaryGateRegistry?.convertToLightweightGate(tempGate);
      if (lightweight) {
        return lightweight;
      }
    }

    const guide = this.gateManager.get(gateId);
    if (!guide) {
      return null;
    }

    return this.toLightweight(guide.getDefinition());
  }

  async loadGates(gateIds: string[]): Promise<LightweightGateDefinition[]> {
    const gates: LightweightGateDefinition[] = [];
    for (const id of gateIds) {
      const gate = await this.loadGate(id);
      if (gate) gates.push(gate);
    }
    return gates;
  }

  async getActiveGates(
    gateIds: string[],
    context: { promptCategory?: string; framework?: string; explicitRequest?: boolean }
  ): Promise<GateActivationResult> {
    const activationContext: GateActivationContext = {};
    if (context.promptCategory) {
      activationContext.promptCategory = context.promptCategory;
    }
    if (context.framework) {
      activationContext.framework = context.framework;
    }
    if (context.explicitRequest !== undefined) {
      activationContext.explicitRequest = context.explicitRequest;
    }

    const activeGuides = this.gateManager.getActiveGates(gateIds, activationContext);

    const activeGates: LightweightGateDefinition[] = [];
    const guidanceText: string[] = [];
    const validationGates: LightweightGateDefinition[] = [];

    for (const guide of activeGuides) {
      const lightweight = this.toLightweight(guide.getDefinition());
      activeGates.push(lightweight);

      if (lightweight.guidance) {
        guidanceText.push(`**${lightweight.name}:**\n${lightweight.guidance}`);
      }

      if (lightweight.type === 'validation') {
        validationGates.push(lightweight);
      }
    }

    return { activeGates, guidanceText, validationGates };
  }

  async listAvailableGates(): Promise<string[]> {
    return this.gateManager.list(true).map((g) => g.gateId);
  }

  async listAvailableGateDefinitions(): Promise<LightweightGateDefinition[]> {
    return this.gateManager.list(true).reduce<LightweightGateDefinition[]>((acc, guide) => {
      acc.push(this.toLightweight(guide.getDefinition()));
      return acc;
    }, []);
  }

  clearCache(): void {
    // GateManager/registry handles its own caching; no-op for compatibility
  }

  /**
   * Determine if a gate should be active for the provided context.
   *
   * Delegates to the canonical isGateActiveForContext utility which handles:
   * - Framework gates (gate_type: 'framework'): AND logic for category+framework
   * - Regular gates: blocking logic where each rule blocks independently
   *
   * @see isGateActiveForContext for implementation details
   */
  isGateActive(
    gate: LightweightGateDefinition,
    context: { promptCategory?: string; framework?: string; explicitRequest?: boolean }
  ): boolean {
    return isGateActiveForContext(gate.activation, context, gate.gate_type);
  }

  getStatistics(): { cachedGates: number; totalLoads: number; lastAccess: Date | null } {
    const stats = this.gateManager.getStats();
    return {
      cachedGates: stats.enabledGates,
      totalLoads: stats.totalGates,
      lastAccess: new Date(),
    };
  }

  async isFrameworkGate(gateId: string): Promise<boolean> {
    const gate = await this.loadGate(gateId);
    return gate?.gate_type === 'framework';
  }

  isFrameworkGateCached(_gateId: string): boolean {
    return false; // registry does not expose cache state; defer to isFrameworkGate for accuracy
  }

  async getFrameworkGateIds(): Promise<string[]> {
    const gates = await this.listAvailableGateDefinitions();
    return gates.filter((g) => g.gate_type === 'framework').map((g) => g.id);
  }

  private toLightweight(definition: LoadedGateDefinition): LightweightGateDefinition {
    const retryConfig = this.normalizeRetryConfig(definition.retry_config);
    const lightweight: LightweightGateDefinition = {
      id: definition.id,
      name: definition.name,
      type: definition.type,
      description: definition.description,
    };

    if (definition.subject) {
      lightweight.subject = definition.subject;
    }
    lightweight.severity = definition.severity;
    if (definition.enforcementMode) {
      lightweight.enforcementMode = definition.enforcementMode;
    }
    if (definition.guidance) {
      lightweight.guidance = definition.guidance;
    }
    if (definition.pass_criteria) {
      lightweight.pass_criteria = definition.pass_criteria;
    }
    if (retryConfig) {
      lightweight.retry_config = retryConfig;
    }
    if (definition.activation) {
      lightweight.activation = definition.activation;
    }
    lightweight.gate_type = definition.gate_type;
    if (definition.guidanceFile) {
      lightweight.guidanceFile = definition.guidanceFile;
    }

    return lightweight;
  }

  private normalizeRetryConfig(
    retry?: LoadedGateDefinition['retry_config']
  ): LightweightGateDefinition['retry_config'] {
    if (!retry) return undefined;
    // The `??` fallbacks stay: `GateRetryConfigSchema` is `.partial()`, which re-wraps each
    // already-defaulted field as optional, so the OUTPUT type still admits `undefined` here
    // even though a parsed `retry_config` carries the values at runtime.
    return {
      max_attempts: retry.max_attempts ?? 2,
      improvement_hints: retry.improvement_hints ?? true,
      preserve_context: retry.preserve_context ?? true,
    };
  }
}

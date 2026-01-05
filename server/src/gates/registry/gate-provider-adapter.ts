// @lifecycle canonical - Adapter that exposes GateManager through the GateDefinitionProvider contract.
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
import type {
  GateActivationContext,
  GateActivationResult,
  GateDefinitionYaml,
  LightweightGateDefinition,
} from '../types.js';

export class GateManagerProvider implements GateDefinitionProvider {
  private readonly gateManager: GateManager;
  private readonly temporaryGateRegistry: TemporaryGateRegistry | undefined;

  constructor(gateManager: GateManager, temporaryGateRegistry?: TemporaryGateRegistry) {
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

    const definition = guide.getDefinition?.() as GateDefinitionYaml | undefined;
    if (!definition) {
      return null;
    }

    return this.toLightweight(definition);
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
      const definition = guide.getDefinition?.() as GateDefinitionYaml | undefined;
      if (!definition) continue;
      const lightweight = this.toLightweight(definition);
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
      const definition = guide.getDefinition?.() as GateDefinitionYaml | undefined;
      if (definition) {
        acc.push(this.toLightweight(definition));
      }
      return acc;
    }, []);
  }

  clearCache(): void {
    // GateManager/registry handles its own caching; no-op for compatibility
  }

  isGateActive(
    gate: LightweightGateDefinition,
    context: { promptCategory?: string; framework?: string; explicitRequest?: boolean }
  ): boolean {
    const activation = gate.activation;
    if (!activation) return true;

    if (activation.explicit_request === true && context.explicitRequest !== true) {
      return false;
    }

    if ((activation.prompt_categories?.length ?? 0) > 0 && context.promptCategory !== undefined) {
      if (activation.prompt_categories?.includes(context.promptCategory) === false) {
        return false;
      }
    }

    if ((activation.framework_context?.length ?? 0) > 0 && context.framework !== undefined) {
      const normalizedFramework = context.framework.toUpperCase();
      const normalizedContexts = activation.framework_context?.map((f) => f.toUpperCase()) ?? [];
      if (!normalizedContexts.includes(normalizedFramework)) {
        return false;
      }
    }

    return true;
  }

  getStatistics(): { cachedGates: number; totalLoads: number; lastAccess: Date | null } {
    const stats = this.gateManager.getStats();
    return {
      cachedGates: stats.enabledGates,
      totalLoads: stats.totalGates,
      lastAccess: new Date(),
    };
  }

  async isMethodologyGate(gateId: string): Promise<boolean> {
    const gate = await this.loadGate(gateId);
    return gate?.gate_type === 'framework';
  }

  isMethodologyGateCached(gateId: string): boolean {
    return false; // registry does not expose cache state; defer to isMethodologyGate for accuracy
  }

  async getMethodologyGateIds(): Promise<string[]> {
    const gates = await this.listAvailableGateDefinitions();
    return gates.filter((g) => g.gate_type === 'framework').map((g) => g.id);
  }

  private toLightweight(definition: GateDefinitionYaml): LightweightGateDefinition {
    const retryConfig = this.normalizeRetryConfig(definition.retry_config);
    const lightweight: LightweightGateDefinition = {
      id: definition.id,
      name: definition.name,
      type: definition.type,
      description: definition.description,
    };

    if (definition.severity) {
      lightweight.severity = definition.severity;
    }
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
    if (definition.gate_type) {
      lightweight.gate_type = definition.gate_type;
    }
    if (definition.guidanceFile) {
      lightweight.guidanceFile = definition.guidanceFile;
    }

    return lightweight;
  }

  private normalizeRetryConfig(
    retry?: GateDefinitionYaml['retry_config']
  ): LightweightGateDefinition['retry_config'] {
    if (!retry) return undefined;
    return {
      max_attempts: retry.max_attempts ?? 2,
      improvement_hints: retry.improvement_hints ?? true,
      preserve_context: retry.preserve_context ?? true,
    };
  }
}

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
export class GateManagerProvider {
    constructor(gateManager, temporaryGateRegistry) {
        this.gateManager = gateManager;
        this.temporaryGateRegistry = temporaryGateRegistry;
    }
    async loadGate(gateId) {
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
        const definition = guide.getDefinition?.();
        if (!definition) {
            return null;
        }
        return this.toLightweight(definition);
    }
    async loadGates(gateIds) {
        const gates = [];
        for (const id of gateIds) {
            const gate = await this.loadGate(id);
            if (gate)
                gates.push(gate);
        }
        return gates;
    }
    async getActiveGates(gateIds, context) {
        const activationContext = {};
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
        const activeGates = [];
        const guidanceText = [];
        const validationGates = [];
        for (const guide of activeGuides) {
            const definition = guide.getDefinition?.();
            if (!definition)
                continue;
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
    async listAvailableGates() {
        return this.gateManager.list(true).map((g) => g.gateId);
    }
    async listAvailableGateDefinitions() {
        return this.gateManager.list(true).reduce((acc, guide) => {
            const definition = guide.getDefinition?.();
            if (definition) {
                acc.push(this.toLightweight(definition));
            }
            return acc;
        }, []);
    }
    clearCache() {
        // GateManager/registry handles its own caching; no-op for compatibility
    }
    isGateActive(gate, context) {
        const activation = gate.activation;
        if (!activation)
            return true;
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
    getStatistics() {
        const stats = this.gateManager.getStats();
        return {
            cachedGates: stats.enabledGates,
            totalLoads: stats.totalGates,
            lastAccess: new Date(),
        };
    }
    async isMethodologyGate(gateId) {
        const gate = await this.loadGate(gateId);
        return gate?.gate_type === 'framework';
    }
    isMethodologyGateCached(gateId) {
        return false; // registry does not expose cache state; defer to isMethodologyGate for accuracy
    }
    async getMethodologyGateIds() {
        const gates = await this.listAvailableGateDefinitions();
        return gates.filter((g) => g.gate_type === 'framework').map((g) => g.id);
    }
    toLightweight(definition) {
        const retryConfig = this.normalizeRetryConfig(definition.retry_config);
        const lightweight = {
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
    normalizeRetryConfig(retry) {
        if (!retry)
            return undefined;
        return {
            max_attempts: retry.max_attempts ?? 2,
            improvement_hints: retry.improvement_hints ?? true,
            preserve_context: retry.preserve_context ?? true,
        };
    }
}
//# sourceMappingURL=gate-provider-adapter.js.map
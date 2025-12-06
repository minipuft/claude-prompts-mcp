import type { IGateService, GateEnhancementResult, GateServiceConfig } from './gate-service-interface.js';
import type { Logger } from '../../logging/index.js';
import type { ConvertedPrompt } from '../../types/index.js';
import type { GateContext } from '../core/gate-definitions.js';
import type { GateValidator } from '../core/gate-validator.js';
import type { GateGuidanceRenderer } from '../guidance/GateGuidanceRenderer.js';
/**
 * Semantic Gate Service - Template rendering + server-side validation (future work)
 */
export declare class SemanticGateService implements IGateService {
    readonly serviceType: "semantic";
    private readonly logger;
    private readonly gateValidator;
    private readonly compositionalService;
    private config;
    constructor(logger: Logger, gateGuidanceRenderer: GateGuidanceRenderer, gateValidator: GateValidator, config?: Partial<GateServiceConfig>);
    enhancePrompt(prompt: ConvertedPrompt, gateIds: string[], context: GateContext): Promise<GateEnhancementResult>;
    supportsValidation(): boolean;
    updateConfig(config: Partial<GateServiceConfig>): void;
    private performSemanticValidation;
}

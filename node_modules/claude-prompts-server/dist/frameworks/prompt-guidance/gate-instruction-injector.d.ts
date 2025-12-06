/**
 * Gate Instruction Injector
 *
 * Provides a pure compositional layer for gate guidance injection, mirroring
 * the behavior of the system prompt injector. No execution coupling.
 */
import { Logger } from '../../logging/index.js';
import type { GateContext } from '../../gates/core/gate-definitions.js';
import type { GateGuidanceRenderer } from '../../gates/guidance/GateGuidanceRenderer.js';
import type { ConvertedPrompt } from '../../types/index.js';
/**
 * Configuration for gate instruction injection behavior.
 */
export interface GateInstructionInjectorConfig {
    enabled: boolean;
}
/**
 * Context for gate instruction injection. Extends renderer context while
 * capturing additional execution metadata for observability.
 */
export interface GateInjectionContext extends GateContext {
    previousAttempts?: number;
    previousFeedback?: string;
    executionType?: string;
}
/**
 * Metadata applied to prompts that have gate instructions appended.
 */
export interface GateInstructionMetadata {
    gateInstructionsInjected?: boolean;
    injectedGateIds?: string[];
    gateInstructionContext?: GateInjectionContext;
    gateInstructionLength?: number;
}
export type GateInstructionEnhancedPrompt = ConvertedPrompt & GateInstructionMetadata;
/**
 * Gate instruction injector responsible for pure template composition.
 */
export declare class GateInstructionInjector {
    private readonly logger;
    private readonly gateGuidanceRenderer;
    private config;
    constructor(logger: Logger, gateGuidanceRenderer: GateGuidanceRenderer, config?: Partial<GateInstructionInjectorConfig>);
    /**
     * Inject gate instructions into the provided prompt template. Returns a new
     * prompt object when injection occurs; otherwise the original prompt is returned.
     */
    injectGateInstructions(prompt: ConvertedPrompt, gateIds: string[], context?: GateInjectionContext): Promise<GateInstructionEnhancedPrompt>;
    private appendInstructions;
    updateConfig(config: Partial<GateInstructionInjectorConfig>): void;
}
export declare function createGateInstructionInjector(logger: Logger, gateGuidanceRenderer: GateGuidanceRenderer, config?: Partial<GateInstructionInjectorConfig>): GateInstructionInjector;

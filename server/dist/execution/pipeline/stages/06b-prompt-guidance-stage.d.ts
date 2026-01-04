import { BasePipelineStage } from '../stage.js';
import type { PromptGuidanceService } from '../../../frameworks/prompt-guidance/index.js';
import type { Logger } from '../../../logging/index.js';
import type { StyleManager } from '../../../styles/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
/**
 * Pipeline Stage: Prompt Guidance
 *
 * Applies methodology-driven system prompt injection and template enhancement
 * using the centralized PromptGuidanceService. In the two-phase client-driven
 * judge flow, this stage applies style enhancement from client selections.
 *
 * Client selections (set by JudgeSelectionStage, checked by this stage):
 * - clientFrameworkOverride: Override framework (used by FrameworkResolutionStage)
 * - clientSelectedGates: Additional gates (used by GateEnhancementStage)
 * - clientSelectedStyle: Response style enhancement (applied by this stage)
 */
export declare class PromptGuidanceStage extends BasePipelineStage {
    private readonly promptGuidanceService;
    private readonly styleManager;
    readonly name = "PromptGuidance";
    constructor(promptGuidanceService: PromptGuidanceService | null, styleManager: StyleManager | null, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    /**
     * Check if client has provided resource selections from judge phase or operator-based style.
     * JudgeSelectionStage sets: clientFrameworkOverride, clientSelectedGates, clientSelectedStyle
     * Symbolic operators set: context.parsedCommand.executionPlan.styleSelection
     */
    private hasClientSelections;
    /**
     * Apply client selections to the execution context.
     * JudgeSelectionStage already set the metadata keys that downstream stages check.
     * This stage only needs to apply style enhancement (not covered by other stages).
     *
     * Style priority (highest first):
     * 1. Operator-based style (#analytical in command)
     * 2. Client-selected style (from judge phase)
     */
    private applyClientSelections;
    /**
     * Apply style enhancement to the prompt based on selected style.
     */
    private applyStyleEnhancement;
    /**
     * Get guidance instructions for a style type.
     * Uses StyleManager if available, falls back to hardcoded styles for backward compatibility.
     */
    private getStyleGuidance;
    /**
     * Enhance a system message with style guidance.
     */
    private enhanceWithStyle;
    private applyGuidanceToChain;
    private applyGuidance;
    private recordGuidanceResult;
    private getGuidanceStore;
    /**
     * Get framework override using the centralized FrameworkDecisionAuthority.
     * This ensures consistent framework resolution across all pipeline stages.
     */
    private getFrameworkOverride;
    /**
     * Build decision input from context for FrameworkDecisionAuthority.
     */
    private buildDecisionInput;
}

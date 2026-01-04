import { BasePipelineStage } from '../stage.js';
/**
 * Stage 2: Execution Planning
 * Delegates to ExecutionPlanner to determine strategy, gates, and validation needs.
 */
export class ExecutionPlanningStage extends BasePipelineStage {
    constructor(executionPlanner, frameworkEnabled, logger) {
        super(logger);
        this.executionPlanner = executionPlanner;
        this.frameworkEnabled = frameworkEnabled;
        this.name = 'ExecutionPlanning';
    }
    async execute(context) {
        this.logEntry(context);
        // Multi-step commands (chains) have steps[], single prompts have convertedPrompt
        // Use type guard for type-safe chain detection
        const hasChainCommand = context.hasChainCommand();
        if (!hasChainCommand && !context.parsedCommand?.convertedPrompt) {
            this.handleError(new Error('Parsed command requires either convertedPrompt or steps.'));
        }
        try {
            let plan;
            if (hasChainCommand) {
                // Multi-step commands: Strategy is always "chain", gates handled per-step
                // Each step has its own convertedPrompt resolved during parsing
                plan = {
                    strategy: 'chain',
                    gates: [], // Gates applied per-step during execution
                    requiresFramework: false,
                    requiresSession: true,
                    gateValidationEnabled: context.mcpRequest.gate_validation ?? false,
                };
            }
            else {
                // Single-prompt commands: Use ExecutionPlanner for full planning
                const parsedCommand = context.requireParsedCommand();
                const convertedPrompt = context.requireConvertedPrompt();
                plan = await this.executionPlanner.createPlan({
                    parsedCommand,
                    convertedPrompt,
                    executionMode: context.mcpRequest.execution_mode ?? 'auto',
                    frameworkEnabled: this.frameworkEnabled?.() ?? false,
                    gateOverrides: {
                        gateValidation: context.mcpRequest.gate_validation,
                        qualityGates: context.mcpRequest.quality_gates
                            ? Array.from(context.mcpRequest.quality_gates)
                            : undefined,
                        customChecks: context.mcpRequest.custom_checks
                            ? context.mcpRequest.custom_checks.map((check) => ({
                                name: check.name,
                                description: check.description,
                            }))
                            : undefined,
                    },
                });
            }
            context.executionPlan = plan;
            this.logExit({
                strategy: plan.strategy,
                gateCount: plan.gates.length,
            });
        }
        catch (error) {
            this.handleError(error, 'Execution planning failed');
        }
    }
}
//# sourceMappingURL=planning-stage.js.map
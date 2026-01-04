import { BasePipelineStage } from '../stage.js';
import type { ChainSessionService } from '../../../chain-session/types.js';
import type { Logger } from '../../../logging/index.js';
import type { IScriptReferenceResolver } from '../../../utils/jsonUtils.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import type { ChainOperatorExecutor } from '../../operators/chain-operator-executor.js';
import type { PromptReferenceResolver } from '../../reference/prompt-reference-resolver.js';
/**
 * Pipeline Stage 9: Step Execution
 *
 * Executes prompts and chain steps with template rendering, framework injection,
 * and gate-enhanced content for quality validation.
 *
 * Dependencies: context.executionPlan, context.convertedPrompt or context.parsedCommand.steps
 * Output: Rendered prompt content ready for LLM execution
 * Can Early Exit: No
 */
export declare class StepExecutionStage extends BasePipelineStage {
    private readonly chainOperatorExecutor;
    private readonly chainSessionManager;
    private readonly referenceResolver?;
    private readonly scriptReferenceResolver?;
    readonly name = "StepExecution";
    constructor(chainOperatorExecutor: ChainOperatorExecutor, chainSessionManager: ChainSessionService, logger: Logger, referenceResolver?: PromptReferenceResolver | undefined, scriptReferenceResolver?: IScriptReferenceResolver | undefined);
    execute(context: ExecutionContext): Promise<void>;
    private executeChainStep;
    private executeSinglePrompt;
    private createExecutionResults;
    /**
     * Build template arguments with script tool results and auto-execute results.
     *
     * Script results are exposed as {{tool_<id>}} in templates.
     * Auto-execute results are exposed as {{tool_<id>_result}} in templates.
     *
     * For example:
     * - A tool with id 'methodology_builder' would be available as {{tool_methodology_builder}}
     * - Its auto-execute result would be available as {{tool_methodology_builder_result}}
     */
    private buildTemplateArgs;
}

// @lifecycle canonical - Runs operator executors and orchestrates outputs.
import { hasFrameworkGuidance } from '../../../frameworks/utils/framework-detection.js';
import { planNodeDrivenRender } from '../../operators/node-step-projection.js';
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
import type { ExecutionRecordStore } from '#modules/chains/execution-record-store.js';
import type { ChainSessionService } from '#shared/types/index.js';
import type { ScriptReferenceResolverPort } from '#shared/utils/jsonUtils.js';
import type { ExecutionContext } from '../../context/index.js';
import type { ChainOperatorExecutor } from '../../operators/chain-operator-executor.js';
import type { ChainStepRenderResult } from '../../operators/types.js';
import type { PromptReferenceResolver } from '../../reference/prompt-reference-resolver.js';

import { isRunComplete } from '#shared/types/chain-session.js';
import { processTemplateWithRefs } from '#shared/utils/jsonUtils.js';

/**
 * Pipeline Stage 18: Step Execution
 *
 * Executes prompts and chain steps with template rendering, framework injection,
 * and gate-enhanced content for quality validation.
 *
 * Dependencies: context.executionPlan, context.convertedPrompt or context.parsedCommand.steps
 * Output: Rendered prompt content ready for LLM execution
 * Can Early Exit: No
 */
export class StepExecutionStage extends BasePipelineStage {
  readonly name = 'StepExecution';

  constructor(
    private readonly chainOperatorExecutor: ChainOperatorExecutor,
    private readonly chainSessionStore: ChainSessionService,
    logger: Logger,
    private readonly referenceResolver?: PromptReferenceResolver,
    private readonly scriptReferenceResolver?: ScriptReferenceResolverPort,
    private readonly executionRecordStore: ExecutionRecordStore | null = null
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    if (context.response) {
      this.logExit({ skipped: 'Response already prepared' });
      return;
    }

    if (context.sessionContext?.pendingReview) {
      this.logExit({ skipped: 'Pending gate review detected' });
      return;
    }

    if (!context.executionPlan) {
      this.handleError(new Error('Execution plan missing before step execution'));
    }

    // Session-completion check for ANY session-based execution (chains and gated single prompts).
    // Latched on run identity (terminal runStatus, or the run standing past its last node),
    // never on `currentStep > totalSteps`: that arithmetic cannot distinguish "on the final
    // step, verdict outstanding" from "finished", and reading it as finished is what made the
    // footer promise completion one call early.
    if (context.sessionContext && this.isRunFinished(context)) {
      context.state.session.chainComplete = true;
      context.executionResults = {
        content: 'Execution complete.',
        generatedAt: Date.now(),
      };
      this.logExit({
        skipped: 'Session complete',
        currentStep: context.sessionContext.currentStep,
        totalSteps: context.sessionContext.totalSteps,
      });
      return;
    }

    // Execute the prompt/chain step regardless of pending review
    // The ResponseFormattingStage will handle appending gate instructions
    // Use type guard for type-safe chain detection
    if (context.executionPlan.strategy === 'chain' && context.hasChainCommand()) {
      await this.executeChainStep(context);
      return;
    }

    await this.executeSinglePrompt(context);
  }

  /**
   * Has this run finished?
   *
   * The store is authoritative — it latches `runStatus` the moment `advanceStep` moves past the
   * terminal node. Where the session cannot be read (single prompts with no run, formatter-only
   * harnesses), the pipeline's own `currentNodeId === null` carries the same fact, set by the
   * session stage and by the verdict processor from `advanceStep`'s return. An *undefined*
   * `currentNodeId` means "unknown", not "complete", so it deliberately reads as unfinished.
   */
  private isRunFinished(context: ExecutionContext): boolean {
    const sessionContext = context.sessionContext;
    if (sessionContext === undefined) return false;

    const session = this.chainSessionStore.getSession(
      sessionContext.sessionId,
      context.getScopeOptions()
    );
    if (session !== undefined) {
      return isRunComplete(session);
    }
    return sessionContext.currentNodeId === null;
  }

  private async executeChainStep(context: ExecutionContext): Promise<void> {
    // Type-safe access using direct field access with proper null checks
    const session = context.sessionContext;
    const steps = context.parsedCommand?.steps;
    const executionPlan = context.executionPlan;

    if (!session) {
      throw new Error('Session context not available for chain execution');
    }

    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      throw new Error('Chain steps not available for chain execution');
    }

    if (!executionPlan) {
      throw new Error('Execution plan not available for chain execution');
    }

    // Render order comes from the RUN's node list, not from the parse-time array (P4 row 3.4,
    // DEV-T3-7). Indexing `steps` by the run's ordinal was correct only while the two lists were
    // the same length: after an adaptive insertion every later node rendered the prompt one
    // ordinal early, and the `Math.min` clamp that used to live here made the last real node
    // unreachable. `parsedCommand.steps` is still what carries per-step authoring data — it is
    // now looked up by node id inside the projection instead of by position.
    const scopeOptions = context.getScopeOptions();
    const run = this.chainSessionStore.getSession(session.sessionId, scopeOptions);
    const plan = planNodeDrivenRender({
      nodes: run?.state.nodes ?? [],
      parseSteps: steps,
      // The store's own view wins over the pipeline's copy, which can lag by a call.
      currentNodeId: run?.state.currentNodeId ?? session.currentNodeId,
      fallbackOrdinal: session.currentStep ?? 1,
      ledger: run?.unknownsLedger,
    });
    const renderSteps = plan.steps;
    const currentStepIndex = plan.currentIndex;

    // A second, ordinal-derived completion branch used to live here, emitting
    // "Chain already complete. No further user_response is required…". It was the same
    // `currentStep > totalSteps` inference the stage entry point now makes from run identity,
    // so it can only be reached after that check has already returned. Removed rather than
    // rewritten: two completion decisions is how the rendered contract came to disagree with
    // the stored run status.

    const currentStep = renderSteps[currentStepIndex];
    if (!currentStep) {
      this.handleError(new Error('Current step not found during execution'));
      return;
    }
    const chainContextSnapshot = this.chainSessionStore.getChainContext(
      session.sessionId,
      scopeOptions
    );

    const normalizedStepArgs = currentStep.args ?? {};

    // Use injection decision from InjectionControlStage (state.injection)
    // inject=true means INJECT, inject=false means SKIP
    const injectionDecision = context.state.injection?.systemPrompt;
    const suppressFrameworkInjection = injectionDecision?.inject === false;

    const renderResult = await this.chainOperatorExecutor.renderStep({
      executionType: 'normal',
      stepPrompts: renderSteps,
      currentStepIndex,
      chainContext: {
        ...chainContextSnapshot,
        sessionId: session.sessionId,
        chainRunId: session.sessionId,
        chainId: session.chainId,
        chain_id: session.chainId,
        requestIdentityContext: context.state.identity.context,
        clientProfile: context.state.identity.context?.clientProfile,
        promptArgs: normalizedStepArgs,
        currentStepArgs: normalizedStepArgs,
        // `getChainContext` derives `input` by indexing the BLUEPRINT's step array with the run
        // ordinal — the same positional read this stage just stopped making. Overriding it with
        // the resolved node's own args keeps `{{input}}` on the node-driven answer. Only when
        // there are args to publish: an empty override would introduce an `input` key on runs
        // that never had one.
        ...(Object.keys(normalizedStepArgs).length > 0 ? { input: normalizedStepArgs } : {}),
        suppressFrameworkInjection, // Pass injection decision to chain executor
        injectionState: context.state.injection, // Also pass full injection state
      },
      additionalGateIds: executionPlan.gates,
    });

    context.executionResults = this.createExecutionResults(renderResult);

    // Record what the render declared (Tier 3.1 / OQ-4). This is the ONLY moment the fact
    // exists: `phases.yaml` is the source the guard already reads, so re-deriving it later
    // would make "declared" and "guarded" identical by construction and leave the advisory
    // branch unreachable. Written against the node id minted on the step just rendered, not
    // `session.currentNodeId`, which is the store's view and can lag by a call.
    if (renderResult.declaredSections !== undefined && currentStep.nodeId !== undefined) {
      this.chainSessionStore.setStepState(
        session.sessionId,
        currentStep.nodeId,
        'rendered',
        false,
        renderResult.declaredSections
      );
    }

    if (this.executionRecordStore !== null) {
      const renderedAt = Date.now();
      this.executionRecordStore.append({
        sessionId: session.sessionId,
        chainId: session.chainId,
        stepNumber: renderResult.stepNumber,
        // Identity of the rendered step. `currentStep.nodeId` is the id minted at parse time on
        // the very step object just handed to the renderer, so it cannot disagree with what was
        // rendered — `session.currentNodeId` is the store's view and can lag by a call. Optional
        // per D4/D10, so a chain parsed before minting binds NULL rather than a guess.
        ...(currentStep.nodeId !== undefined ? { nodeId: currentStep.nodeId } : {}),
        promptId: renderResult.promptId,
        status: 'working',
        substate: { renderedAt },
        startedAt: renderedAt,
        scope: scopeOptions,
      });
    }

    // Record diagnostic for chain step execution
    context.diagnostics.info(this.name, 'Chain step executed', {
      stepNumber: renderResult.stepNumber,
      totalSteps: renderResult.totalSteps,
      promptId: renderResult.promptId,
      contentLength: renderResult.content.length,
      gateCount: executionPlan.gates?.length ?? 0,
      // Whether the run's node list drove this render, or the parse-time array did. A chain
      // parsed before node-id minting falls back positionally and cannot render an insertion.
      nodeDriven: plan.nodeDriven,
    });

    this.logExit({ stepRendered: renderResult.stepNumber });
  }

  private async executeSinglePrompt(context: ExecutionContext): Promise<void> {
    // Type-safe access using direct field access with proper null checks
    const prompt = context.parsedCommand?.convertedPrompt;
    const executionPlan = context.executionPlan;

    if (!prompt) {
      throw new Error('Converted prompt not available for single prompt execution');
    }

    if (!executionPlan) {
      throw new Error('Execution plan not available for single prompt execution');
    }

    // Build template args, enriched with script tool results if available
    const args = this.buildTemplateArgs(context);

    // Resolve {{ref:...}} and {{script:...}} references and render template
    const templateResult = await processTemplateWithRefs(
      prompt.userMessageTemplate,
      args,
      {},
      this.referenceResolver,
      {
        scriptResolver: this.scriptReferenceResolver,
        promptDir: prompt.promptDir, // Enables prompt-local script lookup
      }
    );
    const renderedTemplate = templateResult.content;
    const sections: string[] = [];

    // Use injection decision from InjectionControlStage (state.injection)
    // This is the authoritative source with 7-level hierarchical resolution
    const injectionDecision = context.state.injection?.systemPrompt;
    const injectionSuppressed = injectionDecision?.inject === false;

    // Deduplication: Skip frameworkContext.systemPrompt if prompt.systemMessage already contains framework guidance
    const systemMessageHasFramework = hasFrameworkGuidance(prompt.systemMessage);

    if (
      context.frameworkContext?.systemPrompt &&
      !systemMessageHasFramework &&
      !injectionSuppressed
    ) {
      sections.push(context.frameworkContext.systemPrompt.trim());
      this.logger.debug('StepExecution: Added framework system prompt from context');
    } else if (injectionSuppressed) {
      this.logger.debug(
        'StepExecution: Skipped framework injection (suppressed by injection decision)',
        {
          source: injectionDecision?.source,
        }
      );
    } else if (systemMessageHasFramework) {
      this.logger.debug(
        'StepExecution: Skipped framework context injection (already in prompt.systemMessage)'
      );
    }

    if (prompt.systemMessage?.trim()) {
      sections.push(prompt.systemMessage.trim());
    }

    sections.push(renderedTemplate);

    const combinedContent = sections.filter(Boolean).join('\n\n');

    context.executionResults = {
      content: combinedContent,
      metadata: {
        promptId: prompt.id,
        executionMode: executionPlan.strategy,
        gateIds: executionPlan.gates,
      },
      generatedAt: Date.now(),
    };

    // Record diagnostic for single prompt execution
    context.diagnostics.info(this.name, 'Single prompt executed', {
      promptId: prompt.id,
      contentLength: combinedContent.length,
      hasFrameworkContext: Boolean(context.frameworkContext?.systemPrompt),
      injectionSuppressed,
      gateCount: executionPlan.gates?.length ?? 0,
    });

    this.logExit({ promptId: prompt.id });
  }

  private createExecutionResults(renderResult: ChainStepRenderResult) {
    return {
      content: renderResult.content,
      metadata: {
        stepNumber: renderResult.stepNumber,
        totalSteps: renderResult.totalSteps,
        promptId: renderResult.promptId,
        promptName: renderResult.promptName,
        callToAction: renderResult.callToAction,
        nextStepDelegated: renderResult.nextStepDelegated,
        currentStepDelegated: renderResult.currentStepDelegated,
      },
      generatedAt: Date.now(),
    };
  }

  /**
   * Build template arguments with script tool results and auto-execute results.
   *
   * Script results are exposed as {{tool_<id>}} in templates.
   * Auto-execute results are exposed as {{tool_<id>_result}} in templates.
   *
   * For example:
   * - A tool with id 'framework_builder' would be available as {{tool_framework_builder}}
   * - Its auto-execute result would be available as {{tool_framework_builder_result}}
   */
  private buildTemplateArgs(context: ExecutionContext): Record<string, unknown> {
    const baseArgs = context.getPromptArgs();
    const scriptResults = context.state.scripts?.results;
    const autoExecuteResults = context.state.scripts?.autoExecuteResults;

    const hasScriptResults = scriptResults && scriptResults.size > 0;
    const hasAutoExecuteResults = autoExecuteResults && autoExecuteResults.size > 0;

    if (!hasScriptResults && !hasAutoExecuteResults) {
      return baseArgs;
    }

    // Merge script tool outputs into template context
    const scriptArgs: Record<string, unknown> = {};

    if (hasScriptResults) {
      for (const [toolId, result] of scriptResults) {
        // Only include successful tool outputs
        if (result.success && result.output !== null) {
          scriptArgs[`tool_${toolId}`] = result.output;
        }
      }
    }

    // Merge auto-execute results into template context
    if (hasAutoExecuteResults) {
      for (const [toolId, result] of autoExecuteResults) {
        // Extract text content from ToolResponse for template use
        const textContent = result.content?.find((c: { type: string }) => c.type === 'text');
        scriptArgs[`tool_${toolId}_result`] = {
          isError: result.isError,
          text: (textContent as { text?: string })?.text ?? '',
          content: result.content,
        };
      }
    }

    return {
      ...baseArgs,
      ...scriptArgs,
    };
  }
}

// @lifecycle canonical - Parses incoming commands into structured operators.
import { getExplicitArgumentKeys } from '../../parsers/argument-parser.js';
import { projectChainPromptSteps } from '../../parsers/chain-step-projection.js';
import { COMMAND_SOURCE_EXCLUSIVITY_MESSAGE } from '../../validation/schemas.js';
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
// ChainSessionService no longer needed — blueprint resolution delegated to ChainBlueprintResolver
import type { WorkflowIR, WorkflowRejection } from '#modules/workflow-ir/types.js';
import type { ExecutionContext, ParsedCommand } from '../../context/index.js';
import type {
  ArgumentParser,
  ExecutionContext as ArgumentExecutionContext,
} from '../../parsers/argument-parser.js';
import type { ChainBlueprintResolver } from '../../parsers/chain-blueprint-resolver.js';
import type { UnifiedCommandParser } from '../../parsers/command-parser.js';
import type { SymbolicCommandBuilder } from '../../parsers/symbolic-command-builder.js';
import type { SymbolicCommandParseResult } from '../../parsers/types/operator-types.js';
import type { WorkflowCommandBuilder } from '../../parsers/workflow-command-builder.js';
import type { ConvertedPrompt } from '../../types.js';

import { PromptError } from '#shared/utils/index.js';

/**
 * Provider function to get all converted prompts.
 * Ensures fresh data on each access (supports hot-reload).
 */
type PromptsProvider = () => ConvertedPrompt[];

/**
 * The collaborators this stage runs without.
 *
 * Grouped rather than positional, and the grouping is the point: adding the workflow builder as a
 * seventh positional parameter put the constructor over the `max-params` ceiling, and the fix that
 * keeps the ceiling meaningful is the one `PromptExecutionPipeline`'s own ports bag already
 * models. Both members are genuinely optional — the seven unit and integration suites that
 * construct this stage supply neither, because a symbolic or direct command needs neither.
 */
export interface OptionalParsingCollaborators {
  /** Restores a stored blueprint on a chain resume. Absent means resume is unavailable. */
  readonly blueprintResolver?: ChainBlueprintResolver;
  /** Compiles a submitted Workflow IR. Absent means a workflow submission is a server fault. */
  readonly workflowCommandBuilder?: WorkflowCommandBuilder;
}

/**
 * Pipeline Stage 04: Command Parsing
 *
 * Resolves the request into a `ParsedCommand` from one of THREE mutually exclusive sources:
 * a submitted Workflow IR, a symbolic operator command, or a direct `>>prompt` command. Chain
 * resume takes a fourth path that restores a stored blueprint instead of parsing anything.
 *
 * Domain logic delegated to:
 * - WorkflowCommandBuilder: Workflow IR → ParsedCommand (validate + linearize + compile)
 * - SymbolicCommandBuilder: symbolic operator → ParsedCommand
 * - ChainBlueprintResolver: session blueprint restoration for response-only mode
 *
 * Dependencies: None (always runs first)
 * Output: context.parsedCommand, context.symbolicChain (if operators detected)
 * Can Early Exit: Yes — parsing failure, or a rejected Workflow IR.
 *
 * WRITE-NOTHING-ON-REJECT. A rejected IR sets `context.response` and returns, which the pipeline
 * treats as an early exit (`runStages` stops at the first stage that produced a response). This
 * stage is the 4th of 22 and the first store touch is `SessionManagementStage` (stage 13), so no
 * run row, session or version can exist yet. The pipeline's failure-record writer is also inert
 * here: `emitFailureRecord` returns early while `context.sessionContext` is undefined, which it
 * is until stage 13. Setting a response is used rather than throwing precisely because it keeps
 * the rejection off the error boundary entirely.
 */
export class CommandParsingStage extends BasePipelineStage {
  readonly name = 'CommandParsing';

  constructor(
    private readonly commandParser: UnifiedCommandParser,
    private readonly argumentParser: ArgumentParser,
    private readonly promptsProvider: PromptsProvider,
    logger: Logger,
    private readonly symbolicCommandBuilder: SymbolicCommandBuilder,
    optional: OptionalParsingCollaborators = {}
  ) {
    super(logger);
    this.blueprintResolver = optional.blueprintResolver;
    this.workflowCommandBuilder = optional.workflowCommandBuilder;
  }

  private readonly blueprintResolver: ChainBlueprintResolver | undefined;
  private readonly workflowCommandBuilder: WorkflowCommandBuilder | undefined;

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    const workflow = context.mcpRequest.workflow;
    if (workflow !== undefined) {
      this.executeWorkflowSubmission(context, workflow);
      return;
    }

    // P6.119: `command` beside a `chain_id` names two runs. The tool schema refuses it; an
    // in-process caller skips the schema, and an append never reaches here as a command
    // (`PromptExecutor` rewrites it into `remainder` first), so no such pair is admissible.
    if (collectSourceConflicts(context).length > 1) {
      this.rejectWorkflow(context, [
        { reason: 'mutually-exclusive-source', detail: COMMAND_SOURCE_EXCLUSIVITY_MESSAGE },
      ]);
      return;
    }

    if (context.isResponseOnlyMode()) {
      this.resumeFromBlueprint(context);
      return;
    }

    const incomingCommand =
      context.state.normalization.normalizedCommand ?? context.mcpRequest.command;
    if (!incomingCommand) {
      this.handleError(new Error('Command missing for parsing stage'));
    }

    try {
      const parseResult = await this.commandParser.parseCommand(
        incomingCommand,
        this.promptsProvider()
      );

      if (
        parseResult.format === 'symbolic' &&
        (parseResult as SymbolicCommandParseResult).executionPlan
      ) {
        const symbolic = await this.symbolicCommandBuilder.buildSymbolicCommand(
          parseResult as SymbolicCommandParseResult,
          (idOrName) => this.findConvertedPrompt(idOrName),
          requestedGates(context)
        );
        if (!symbolic.ok) {
          // An arrow-chain the Workflow IR validator refused (P6.105), or a request gate
          // targeting a step the command does not declare (P6.124): the same addressed
          // rejection a workflow submission gets, before any store is touched.
          this.rejectWorkflow(context, symbolic.rejections);
          return;
        }
        const symbolicCommand = symbolic.parsedCommand;
        retargetRequestedGates(context, symbolic.retargetRequestedGates);

        const symbolicPrompt = this.findConvertedPrompt(symbolicCommand.promptId);
        this.mergeRequestArguments(
          symbolicCommand.promptArgs,
          parseResult.rawArgs,
          symbolicPrompt,
          context
        );

        context.parsedCommand = symbolicCommand;
        this.logExit({
          promptId: parseResult.promptId,
          format: parseResult.format,
          type: 'symbolic',
        });
        return;
      }

      const direct = await this.buildDirectCommand(parseResult, context);
      // P6.124: a request gate targeting a step this command does not declare is refused as the
      // IR-building sources refuse it, before any store is touched.
      const rejections = this.symbolicCommandBuilder.requestGateTargetRejections(
        direct,
        requestedGates(context)
      );
      if (rejections.length > 0) {
        this.rejectWorkflow(context, rejections);
        return;
      }
      context.parsedCommand = direct;

      this.logExit({
        promptId: context.parsedCommand.promptId,
        format: context.parsedCommand.format,
        operatorTypes: context.parsedCommand.operators?.operatorTypes,
      });
    } catch (error) {
      this.handleError(error, 'Command parsing failed');
    }
  }

  /**
   * The resume path: restore the run's stored blueprint instead of parsing anything.
   *
   * P6.126: this call's request gates target the run's declared node ids — the restored parsed
   * steps' ids, or `n1` for a one-node run — checked as every start source checks them (P6.124),
   * and refused before any stage touches the run. The start call's own gates, which the blueprint
   * carries, were checked when that call ran.
   */
  private resumeFromBlueprint(context: ExecutionContext): void {
    this.logger.debug('[ParsingStage] Response-only mode detected - resuming chain', {
      chainId: context.mcpRequest.chain_id,
      hasUserResponse: Boolean(context.mcpRequest.user_response),
    });
    if (!this.blueprintResolver) {
      this.handleError(new Error('ChainBlueprintResolver unavailable for response-only execution'));
    }
    this.blueprintResolver.restoreFromBlueprint(context);
    const restored = context.parsedCommand;
    if (restored === undefined) {
      this.handleError(new Error('Blueprint restore set no parsed command'));
    }
    const rejections = this.symbolicCommandBuilder.requestGateTargetRejections(
      restored,
      requestedGates(context)
    );
    if (rejections.length > 0) {
      this.rejectWorkflow(context, rejections);
      return;
    }
    this.logExit({ skipped: 'Response-only session rehydrated' });
  }

  /**
   * The Workflow IR command source.
   *
   * Thin by construction: exclusivity is a request-shape question this stage owns, and everything
   * else — schema conformance, caps, acyclicity, linearization, compilation — belongs to
   * `modules/workflow-ir/` and reaches this stage only through the injected builder.
   */
  private executeWorkflowSubmission(context: ExecutionContext, workflow: WorkflowIR): void {
    const conflicts = collectSourceConflicts(context);
    if (conflicts.length > 0) {
      this.rejectWorkflow(context, [
        {
          reason: 'mutually-exclusive-source',
          detail: `A workflow submission cannot be combined with ${conflicts.join(' or ')}; submit a workflow on its own, or omit it and use the command/resume parameters`,
        },
      ]);
      return;
    }

    if (!this.workflowCommandBuilder) {
      // Not an early exit with a rejection: the client's submission was well-formed and the
      // server is misconfigured. `handleError` routes it to the pipeline's error boundary, which
      // is where a server fault belongs.
      this.handleError(
        new Error('WorkflowCommandBuilder unavailable for workflow submission'),
        'Workflow submission received but no builder is wired'
      );
    }

    const result = this.workflowCommandBuilder.build(
      withRequestedGates(workflow, context),
      (idOrName) => this.findConvertedPrompt(idOrName)
    );

    if (!result.ok) {
      this.rejectWorkflow(context, result.rejections);
      return;
    }

    context.parsedCommand = result.parsedCommand;
    retargetRequestedGates(context, result.retargetRequestedGates);
    this.logExit({
      promptId: result.parsedCommand.promptId,
      format: result.parsedCommand.format,
      type: 'workflow',
      steps: result.parsedCommand.steps?.length ?? 0,
    });
  }

  /**
   * Turn typed rejections into an addressed client response and stop the pipeline here.
   *
   * Every line names the offending node or edge and the rule violated, because acceptance clause
   * (b) is "actionable", and a client that has to guess WHICH node failed fixes its submission one
   * error per round trip — the failure mode the rejection vocabulary exists to remove.
   */
  private rejectWorkflow(
    context: ExecutionContext,
    rejections: readonly WorkflowRejection[]
  ): void {
    const lines = rejections.map((rejection) => {
      const address =
        rejection.edge !== undefined
          ? `edge ${rejection.edge.from} -> ${rejection.edge.to}`
          : rejection.nodeId !== undefined
            ? `node "${rejection.nodeId}"`
            : 'workflow';
      return `• [${rejection.reason}] ${address}: ${rejection.detail}`;
    });

    context.diagnostics.warn(this.name, 'Workflow submission rejected', {
      count: rejections.length,
      reasons: rejections.map((rejection) => rejection.reason),
    });

    context.setResponse({
      content: [
        {
          type: 'text',
          text: [
            `❌ Workflow rejected — ${rejections.length} problem${rejections.length === 1 ? '' : 's'} found. Nothing was executed and no run was created.`,
            '',
            ...lines,
          ].join('\n'),
        },
      ],
      isError: true,
    });

    this.logExit({ rejectedWorkflow: rejections.length });
  }

  /**
   * Build ParsedCommand for non-symbolic (direct) commands.
   */
  private async buildDirectCommand(
    parseResult: import('../../parsers/command-parser.js').CommandParseResult,
    context: ExecutionContext
  ): Promise<ParsedCommand> {
    const convertedPrompt = this.findConvertedPrompt(parseResult.promptId);
    if (!convertedPrompt) {
      throw new PromptError(`Converted prompt data not found for: ${parseResult.promptId}`);
    }

    const argResult = await this.argumentParser.parseArguments(
      parseResult.rawArgs,
      convertedPrompt,
      this.createArgumentContext()
    );

    const parsedCommand: ParsedCommand = {
      ...parseResult,
      convertedPrompt,
      promptArgs: (argResult as any).processedArgs,
    };

    this.mergeRequestArguments(
      parsedCommand.promptArgs,
      parseResult.rawArgs,
      convertedPrompt,
      context
    );

    // After the request merge above, so a step sharing the run's arguments sees it (P6.74: the
    // symbolic builder calls the same projection).
    const projection = projectChainPromptSteps(
      convertedPrompt,
      (argResult as any).processedArgs,
      (idOrName) => this.findConvertedPrompt(idOrName)
    );
    if (projection !== undefined) {
      Object.assign(parsedCommand, projection);
    }

    return parsedCommand;
  }

  /** Merge defaults, legacy options, and typed inputs while preserving explicit inline values. */
  private mergeRequestArguments(
    promptArgs: Record<string, any> | undefined,
    rawArgs: string,
    prompt: ConvertedPrompt | undefined,
    context: ExecutionContext
  ): void {
    const requestOptions = context.state.normalization.requestOptions;
    const requestInputs = context.state.normalization.requestInputs;
    if (
      promptArgs === undefined ||
      prompt === undefined ||
      (requestOptions === undefined && requestInputs === undefined)
    ) {
      return;
    }

    const explicitKeys = new Set(getExplicitArgumentKeys(rawArgs));
    for (const values of [requestOptions, requestInputs]) {
      if (values === undefined) continue;
      for (const [key, value] of Object.entries(values)) {
        if (!explicitKeys.has(key)) {
          promptArgs[key] = value;
        }
      }
    }

    this.argumentParser.validateResolvedArguments(prompt, promptArgs);
  }

  private findConvertedPrompt(idOrName: string): ConvertedPrompt | undefined {
    const prompts = this.promptsProvider();
    const key = idOrName.toLowerCase();
    for (const prompt of prompts) {
      if (prompt.id.toLowerCase() === key || prompt.name?.toLowerCase() === key) {
        return prompt;
      }
    }
    return undefined;
  }

  private createArgumentContext(): ArgumentExecutionContext {
    return {
      conversationHistory: [],
      environmentVars: process.env as Record<string, string>,
      promptDefaults: {},
      systemContext: {},
    };
  }
}

/**
 * Which other command sources a workflow submission collided with.
 *
 * Enforced here as well as in the Zod `.refine` on the tool surface because the schema guards the
 * MCP boundary only: `PromptExecutor.executePromptCommand` is called directly by tests and by
 * in-process callers, and a mutual-exclusivity rule that lives solely in the schema is one those
 * callers can walk past. Returns the conflicting parameter NAMES rather than a boolean so the
 * rejection can say which one, which is the difference between an addressed rejection and a
 * restatement of the rule.
 *
 * `user_response` and `gate_verdict` are not listed: they are resume payloads that are inert
 * without a `chain_id`, which is listed.
 *
 * Also read with no workflow present: both names returned means `command` beside `chain_id`
 * (P6.119), refused by the same rule.
 */
function collectSourceConflicts(context: ExecutionContext): string[] {
  const conflicts: string[] = [];
  const command = context.mcpRequest.command;
  if (typeof command === 'string' && command.trim().length > 0) {
    conflicts.push("'command'");
  }
  if (typeof context.mcpRequest.chain_id === 'string' && context.mcpRequest.chain_id.length > 0) {
    conflicts.push("'chain_id'");
  }
  return conflicts;
}

/**
 * The request's gates as stage 01 captured them: the `gates` parameter plus, on a workflow
 * submission, the workflow's own `gates` (the executor concatenates them, same objects).
 */
function requestedGates(context: ExecutionContext): NonNullable<WorkflowIR['gates']> {
  return (context.state.gates.requestedOverrides?.gates ?? []) as NonNullable<WorkflowIR['gates']>;
}

/**
 * The submission with every requested gate on it, for validation (P6.117): a `gates` parameter
 * sent beside a workflow addresses the same declared node ids as the workflow's own `gates`.
 */
function withRequestedGates(workflow: WorkflowIR, context: ExecutionContext): WorkflowIR {
  const own = workflow.gates ?? [];
  const beside = requestedGates(context).filter((gate) => !own.includes(gate));
  return beside.length > 0 ? { ...workflow, gates: [...own, ...beside] } : workflow;
}

/**
 * Point every requested gate whose `target_step_id` names a node that expanded into a chain
 * prompt's steps at that node's last step (R41).
 *
 * The workflow's `gates` are read from the request channel (`requestedOverrides.gates`, where the
 * executor concatenates them onto the `gates` parameter), never from the IR, so the retarget the
 * expansion computed is applied here — through the builder's result, which binds the expansion's
 * own `retargetGates` (`engine/` may not value-import it). It returns new objects: the originals
 * are the client's submission.
 */
function retargetRequestedGates(
  context: ExecutionContext,
  retarget: <Gate>(gates: readonly Gate[]) => Gate[]
): void {
  const overrides = context.state.gates.requestedOverrides;
  if (overrides !== undefined && Array.isArray(overrides.gates)) {
    overrides.gates = retarget(overrides.gates);
  }
}

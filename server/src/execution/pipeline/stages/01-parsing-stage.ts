// @lifecycle canonical - Parses incoming commands into structured operators.
import { PromptError } from '../../../utils/index.js';
import { BasePipelineStage } from '../stage.js';

import type { ChainSessionService, SessionBlueprint } from '../../../chain-session/types.js';
import type { Logger } from '../../../logging/index.js';
import type { ConvertedPrompt } from '../../../types/index.js';
import type { ExecutionContext, ParsedCommand } from '../../context/execution-context.js';
import type { ChainStepPrompt } from '../../operators/types.js';
import type {
  ArgumentParser,
  ExecutionContext as ArgumentExecutionContext,
} from '../../parsers/argument-parser.js';
import type { UnifiedCommandParser } from '../../parsers/command-parser.js';
import type {
  GateOperator,
  SymbolicCommandParseResult,
} from '../../parsers/types/operator-types.js';
import type { ExecutionPlan } from '../../types.js';

type ParsedArgumentsResult = {
  processedArgs: Record<string, any>;
  resolvedPlaceholders: Record<string, any>;
};

/**
 * Canonical Pipeline Stage 1: Command Parsing
 *
 * Parses incoming commands using UnifiedCommandParser, resolves arguments,
 * and builds symbolic chains for operator-based workflows.
 *
 * Dependencies: None (always runs first)
 * Output: context.parsedCommand, context.symbolicChain (if operators detected)
 * Can Early Exit: Yes (if parsing fails)
 */
export class CommandParsingStage extends BasePipelineStage {
  readonly name = 'CommandParsing';

  private readonly convertedPrompts: ConvertedPrompt[];
  private readonly promptLookup: Map<string, ConvertedPrompt>;

  constructor(
    private readonly commandParser: UnifiedCommandParser,
    private readonly argumentParser: ArgumentParser,
    convertedPrompts: ConvertedPrompt[],
    logger: Logger,
    private readonly chainSessionManager?: ChainSessionService
  ) {
    super(logger);
    this.convertedPrompts = convertedPrompts;
    this.promptLookup = this.createPromptLookup(convertedPrompts);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    if (context.isResponseOnlyMode()) {
      this.logger.debug(
        '[ParsingStage] Response-only mode detected - resuming chain without command',
        {
          chainId: context.mcpRequest.chain_id,
          hasUserResponse: Boolean(context.mcpRequest.user_response),
          hasCommand: Boolean(context.mcpRequest.command),
        }
      );
      this.restoreFromBlueprint(context);
      this.logExit({ skipped: 'Response-only session rehydrated' });
      return;
    }

    const incomingCommand = context.mcpRequest.command;
    if (!incomingCommand) {
      this.handleError(new Error('Command missing for parsing stage'));
    }

    try {
      const parseResult = await this.commandParser.parseCommand(
        incomingCommand,
        this.convertedPrompts
      );

      if (
        parseResult.format === 'symbolic' &&
        (parseResult as SymbolicCommandParseResult).executionPlan
      ) {
        const symbolicCommand = await this.buildSymbolicCommand(
          parseResult as SymbolicCommandParseResult
        );

        // Merge requestOptions into promptArgs for symbolic commands
        // Options values override empty/falsy placeholder values from prompt definitions
        // but inline args (truthy values) still take precedence
        const requestOptions = context.state.normalization.requestOptions;
        if (requestOptions && typeof requestOptions === 'object' && symbolicCommand.promptArgs) {
          const mergedArgs = symbolicCommand.promptArgs;
          for (const [key, value] of Object.entries(requestOptions)) {
            // Merge if key missing OR existing value is falsy (empty placeholder)
            const existing = mergedArgs[key];
            const isFalsyOrEmpty =
              existing === undefined ||
              existing === null ||
              existing === '' ||
              (Array.isArray(existing) && existing.length === 0);
            if (!(key in mergedArgs) || isFalsyOrEmpty) {
              mergedArgs[key] = value;
            }
          }
        }

        context.parsedCommand = symbolicCommand;
        this.logExit({
          promptId: parseResult.promptId,
          format: parseResult.format,
          type: 'symbolic',
        });
        return;
      }

      const convertedPrompt = this.findConvertedPrompt(parseResult.promptId);
      if (!convertedPrompt) {
        throw new PromptError(`Converted prompt data not found for: ${parseResult.promptId}`);
      }

      const argResult = await this.argumentParser.parseArguments(
        parseResult.rawArgs,
        convertedPrompt,
        this.createArgumentContext()
      );

      // Merge requestOptions into processedArgs (options parameter from prompt_engine call)
      // Options values override empty/falsy placeholder values from prompt definitions
      // but inline args (truthy values) still take precedence
      const requestOptions = context.state.normalization.requestOptions;
      if (requestOptions && typeof requestOptions === 'object') {
        const mergedArgs = argResult.processedArgs as Record<string, unknown>;
        for (const [key, value] of Object.entries(requestOptions)) {
          // Merge if key missing OR existing value is falsy (empty placeholder)
          const existing = mergedArgs[key];
          const isFalsyOrEmpty =
            existing === undefined ||
            existing === null ||
            existing === '' ||
            (Array.isArray(existing) && existing.length === 0);
          if (!(key in mergedArgs) || isFalsyOrEmpty) {
            mergedArgs[key] = value;
          }
        }
      }

      const parsedCommand: ParsedCommand = {
        ...parseResult,
        convertedPrompt,
        promptArgs: argResult.processedArgs,
      };

      // Update commandType to 'chain' if prompt definition has chainSteps
      // (Parser defaults to 'single' because it can't see the prompt definition)
      if (convertedPrompt.chainSteps?.length) {
        parsedCommand.commandType = 'chain';
        parsedCommand.steps = convertedPrompt.chainSteps.map((step, index) => ({
          stepNumber: index + 1,
          promptId: step.promptId,
          args: argResult.processedArgs, // Use parsed arguments from command
          variableName: step.stepName ?? `step_${index + 1}`,
          convertedPrompt,
          inputMapping: step.inputMapping,
          outputMapping: step.outputMapping,
          retries: step.retries,
        })) as ChainStepPrompt[];
      }

      context.parsedCommand = parsedCommand;

      this.logExit({
        promptId: parsedCommand.promptId,
        format: parsedCommand.format,
        operatorTypes: parsedCommand.operators?.operatorTypes,
      });
    } catch (error) {
      this.handleError(error, 'Command parsing failed');
    }
  }

  private createPromptLookup(prompts: ConvertedPrompt[]): Map<string, ConvertedPrompt> {
    const map = new Map<string, ConvertedPrompt>();
    for (const prompt of prompts) {
      map.set(prompt.id.toLowerCase(), prompt);
      if (prompt.name) {
        map.set(prompt.name.toLowerCase(), prompt);
      }
    }
    return map;
  }

  private findConvertedPrompt(idOrName: string): ConvertedPrompt | undefined {
    return this.promptLookup.get(idOrName.toLowerCase());
  }

  private async buildSymbolicCommand(
    parseResult: SymbolicCommandParseResult
  ): Promise<ParsedCommand> {
    const hasChainOperator = this.hasChainOperator(parseResult);
    if (!hasChainOperator) {
      return this.buildSingleSymbolicPrompt(parseResult);
    }

    return this.buildSymbolicChain(parseResult);
  }

  private async buildSingleSymbolicPrompt(
    parseResult: SymbolicCommandParseResult
  ): Promise<ParsedCommand> {
    const baseStep = parseResult.executionPlan.steps[0];
    if (!baseStep?.promptId) {
      throw new PromptError('Symbolic command requires a valid prompt identifier.');
    }

    const convertedPrompt = this.findConvertedPrompt(baseStep.promptId);
    if (!convertedPrompt) {
      throw new PromptError(`Converted prompt data not found for: ${baseStep.promptId}`);
    }

    const argumentInput = this.getStepArgumentInput(parseResult.executionPlan, 0);
    const fallbackArgs =
      baseStep.args && baseStep.args.trim().length > 0
        ? await this.parseArgumentsSafely(baseStep.args, convertedPrompt)
        : undefined;

    const resolvedArgs = await this.resolveArgumentPayload(
      convertedPrompt,
      argumentInput,
      baseStep.inlineGateCriteria,
      fallbackArgs?.processedArgs
    );

    // Collect both anonymous and named gates
    const { anonymousCriteria, namedGates } = this.collectGateCriteria(parseResult);

    const inlineCriteria =
      resolvedArgs.inlineCriteria.length > 0 ? resolvedArgs.inlineCriteria : anonymousCriteria;

    const parsedCommand: ParsedCommand = {
      ...parseResult,
      convertedPrompt,
      promptArgs: resolvedArgs.processedArgs,
      inlineGateCriteria: inlineCriteria,
    };

    if (namedGates.length > 0) {
      parsedCommand.namedInlineGates = namedGates;
    }
    if (parseResult.executionPlan.styleSelection !== undefined) {
      parsedCommand.styleSelection = parseResult.executionPlan.styleSelection;
    }

    return parsedCommand;
  }

  private async buildSymbolicChain(
    parseResult: SymbolicCommandParseResult
  ): Promise<ParsedCommand> {
    const stepPrompts: ChainStepPrompt[] = [];
    let commandArgs: Record<string, any> = {};

    const argumentInputs = parseResult.executionPlan.argumentInputs ?? [];

    // Collect both anonymous and named gate criteria from gate operator (::)
    const { anonymousCriteria: globalGateCriteria, namedGates } =
      this.collectGateCriteria(parseResult);

    for (const [index, step] of parseResult.executionPlan.steps.entries()) {
      if (!step.promptId) {
        continue;
      }

      const convertedPrompt = this.findConvertedPrompt(step.promptId);
      if (!convertedPrompt) {
        throw new PromptError(`Converted prompt data not found for chain step: ${step.promptId}`);
      }

      const stepArgumentInput = argumentInputs[index];
      const fallbackArgs =
        step.args && step.args.trim().length > 0
          ? await this.parseArgumentsSafely(step.args, convertedPrompt)
          : undefined;

      // Merge step-level and global gate criteria
      const combinedGateCriteria = [...(step.inlineGateCriteria ?? []), ...globalGateCriteria];

      const resolvedArgs = await this.resolveArgumentPayload(
        convertedPrompt,
        stepArgumentInput,
        combinedGateCriteria,
        fallbackArgs?.processedArgs
      );

      if (stepPrompts.length === 0) {
        commandArgs = resolvedArgs.processedArgs;
      }

      stepPrompts.push({
        stepNumber: step.stepNumber ?? stepPrompts.length + 1,
        promptId: convertedPrompt.id,
        convertedPrompt,
        args: resolvedArgs.processedArgs,
        inlineGateCriteria: resolvedArgs.inlineCriteria,
      });
    }

    const parsedCommand: ParsedCommand = {
      ...parseResult,
      steps: stepPrompts,
      promptArgs: commandArgs,
    };

    if (namedGates.length > 0) {
      parsedCommand.namedInlineGates = namedGates;
    }
    if (parseResult.executionPlan.styleSelection !== undefined) {
      parsedCommand.styleSelection = parseResult.executionPlan.styleSelection;
    }

    return parsedCommand;
  }

  private createArgumentContext(): ArgumentExecutionContext {
    return {
      conversationHistory: [],
      environmentVars: process.env as Record<string, string>,
      promptDefaults: {},
      systemContext: {},
    };
  }

  private hasChainOperator(parseResult: SymbolicCommandParseResult): boolean {
    const operators = parseResult.operators?.operators;
    if (!Array.isArray(operators)) {
      return false;
    }
    return operators.some((operator) => operator.type === 'chain');
  }

  private async resolveArgumentPayload(
    prompt: ConvertedPrompt,
    sanitizedArgs?: string,
    inlineCriteriaSeed: string[] = [],
    fallbackArgs?: Record<string, any>
  ): Promise<ParsedArgumentsResult & { inlineCriteria: string[] }> {
    const seed = Array.isArray(inlineCriteriaSeed)
      ? inlineCriteriaSeed.filter((item): item is string => Boolean(item && item.trim()))
      : [];

    const normalizedSeed = Array.from(new Set(seed));

    if (!sanitizedArgs?.trim()) {
      if (fallbackArgs && Object.keys(fallbackArgs).length > 0) {
        return {
          processedArgs: { ...fallbackArgs },
          resolvedPlaceholders: {},
          inlineCriteria: normalizedSeed,
        };
      }

      return {
        processedArgs: {},
        resolvedPlaceholders: {},
        inlineCriteria: normalizedSeed,
      };
    }

    const parsed = await this.parseArgumentsSafely(sanitizedArgs, prompt);

    const processedArgs =
      parsed.processedArgs && Object.keys(parsed.processedArgs).length > 0
        ? parsed.processedArgs
        : fallbackArgs
          ? { ...fallbackArgs }
          : {};

    return {
      processedArgs,
      resolvedPlaceholders: parsed.resolvedPlaceholders,
      inlineCriteria: normalizedSeed,
    };
  }

  private async parseArgumentsSafely(
    argsString: string,
    prompt: ConvertedPrompt
  ): Promise<ParsedArgumentsResult> {
    if (!argsString?.trim()) {
      return {
        processedArgs: {},
        resolvedPlaceholders: {},
      };
    }

    try {
      const argResult = await this.argumentParser.parseArguments(
        argsString,
        prompt,
        this.createArgumentContext()
      );
      return {
        processedArgs: argResult.processedArgs ?? {},
        resolvedPlaceholders: argResult.resolvedPlaceholders ?? {},
      };
    } catch (error) {
      this.logger.warn('[ParsingStage] Failed to parse symbolic command arguments', {
        error,
        promptId: prompt.id,
      });
      return {
        processedArgs: {},
        resolvedPlaceholders: {},
      };
    }
  }

  /**
   * Separates gate operators into named and anonymous criteria.
   * Named gates (with gateId) are returned separately for explicit ID registration.
   * Anonymous criteria are merged together for backward-compatible temp gate creation.
   * Shell verification gates (with shellVerify) are included for Ralph Wiggum loops.
   */
  private collectGateCriteria(parseResult: SymbolicCommandParseResult): {
    anonymousCriteria: string[];
    namedGates: Array<{
      gateId: string;
      criteria: string[];
      shellVerify?: { command: string; timeout?: number; workingDir?: string };
    }>;
  } {
    const operators = parseResult.operators?.operators;
    if (!Array.isArray(operators)) {
      return { anonymousCriteria: [], namedGates: [] };
    }

    const anonymousCriteria: string[] = [];
    const namedGates: Array<{
      gateId: string;
      criteria: string[];
      shellVerify?: { command: string; timeout?: number; workingDir?: string };
    }> = [];

    for (const op of operators) {
      if (op.type !== 'gate') continue;
      const gate = op;

      // DEBUG: Trace what the parser produces
      this.logger.debug('[collectGateCriteria] Processing gate operator:', {
        gateId: gate.gateId,
        hasShellVerify: Boolean(gate.shellVerify),
        shellVerify: gate.shellVerify,
        criteria: gate.criteria,
        parsedCriteria: gate.parsedCriteria,
      });

      const criteria =
        Array.isArray(gate.parsedCriteria) && gate.parsedCriteria.length
          ? gate.parsedCriteria
          : [gate.criteria];

      const cleanedCriteria = criteria
        .map((item) => item?.trim())
        .filter((item): item is string => Boolean(item));

      if (gate.gateId) {
        // Named gate - keep ID association (includes shell verification gates)
        const namedGate: {
          gateId: string;
          criteria: string[];
          shellVerify?: { command: string; timeout?: number; workingDir?: string };
        } = { gateId: gate.gateId, criteria: cleanedCriteria };

        // Preserve shellVerify config for Ralph Wiggum loops
        if (gate.shellVerify) {
          namedGate.shellVerify = gate.shellVerify;
        }

        // DEBUG: Trace final namedGate before push
        this.logger.debug('[collectGateCriteria] Created namedGate:', {
          gateId: namedGate.gateId,
          hasShellVerify: Boolean(namedGate.shellVerify),
          shellVerifyCommand: namedGate.shellVerify?.command,
          criteria: namedGate.criteria,
        });

        namedGates.push(namedGate);
      } else {
        // Anonymous gate - merge with others
        anonymousCriteria.push(...cleanedCriteria);
      }
    }

    return {
      anonymousCriteria: Array.from(new Set(anonymousCriteria)),
      namedGates,
    };
  }

  /** @deprecated Use collectGateCriteria for named gate support */
  private collectGlobalInlineCriteria(parseResult: SymbolicCommandParseResult): string[] {
    const { anonymousCriteria } = this.collectGateCriteria(parseResult);
    return anonymousCriteria;
  }

  private restoreFromBlueprint(context: ExecutionContext): void {
    if (!this.chainSessionManager) {
      throw new Error('ChainSessionManager unavailable for response-only execution');
    }

    let sessionId = context.getSessionId();
    let blueprint = sessionId ? this.chainSessionManager.getSessionBlueprint(sessionId) : undefined;

    if (!blueprint) {
      const requestedChainId = context.mcpRequest.chain_id;
      if (requestedChainId) {
        const session = this.chainSessionManager.getSessionByChainIdentifier(requestedChainId, {
          includeDormant: true,
        });
        if (session) {
          sessionId = session.sessionId;
          context.state.session.resumeSessionId = session.sessionId;
          context.state.session.resumeChainId = session.chainId;
          blueprint = session.blueprint
            ? this.cloneBlueprint(session.blueprint)
            : this.chainSessionManager.getSessionBlueprint(session.sessionId);
        }
      }
    }

    if (!blueprint || !sessionId) {
      throw new Error(
        'No stored execution blueprint found for the requested session or chain. Re-run the original command to continue.'
      );
    }

    context.parsedCommand = this.cloneParsedCommand(blueprint.parsedCommand);
    context.executionPlan = this.cloneExecutionPlan(blueprint.executionPlan);
    if (blueprint.gateInstructions) {
      context.gateInstructions = blueprint.gateInstructions;
    }
    context.state.session.resumeSessionId = sessionId;
    const resolvedResumeChainId =
      context.state.session.resumeChainId ?? blueprint.parsedCommand.chainId;
    if (resolvedResumeChainId !== undefined) {
      context.state.session.resumeChainId = resolvedResumeChainId;
    }
    context.state.session.isBlueprintRestored = true;
  }

  private cloneParsedCommand(parsedCommand: ParsedCommand): ParsedCommand {
    return JSON.parse(JSON.stringify(parsedCommand)) as ParsedCommand;
  }

  private cloneExecutionPlan(plan: ExecutionPlan): ExecutionPlan {
    return JSON.parse(JSON.stringify(plan)) as ExecutionPlan;
  }

  private cloneBlueprint(blueprint: SessionBlueprint): SessionBlueprint {
    const cloned: SessionBlueprint = {
      parsedCommand: this.cloneParsedCommand(blueprint.parsedCommand),
      executionPlan: this.cloneExecutionPlan(blueprint.executionPlan),
    };

    if (blueprint.gateInstructions !== undefined) {
      cloned.gateInstructions = blueprint.gateInstructions;
    }

    return cloned;
  }

  private getStepArgumentInput(
    executionPlan: SymbolicCommandParseResult['executionPlan'],
    index: number
  ): string | undefined {
    if (!executionPlan.argumentInputs || index < 0) {
      return undefined;
    }

    return executionPlan.argumentInputs[index];
  }
}

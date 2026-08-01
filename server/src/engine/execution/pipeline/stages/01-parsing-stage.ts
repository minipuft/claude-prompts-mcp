// @lifecycle canonical - Parses incoming commands into structured operators.
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '#infra/logging/index.js';
// ChainSessionService no longer needed — blueprint resolution delegated to ChainBlueprintResolver
import type { ExecutionContext, ParsedCommand } from '../../context/index.js';
import type { ChainStepPrompt } from '../../operators/types.js';
import type {
  ArgumentParser,
  ExecutionContext as ArgumentExecutionContext,
} from '../../parsers/argument-parser.js';
import type { ChainBlueprintResolver } from '../../parsers/chain-blueprint-resolver.js';
import type { UnifiedCommandParser } from '../../parsers/command-parser.js';
import type { SymbolicCommandBuilder } from '../../parsers/symbolic-command-builder.js';
import type { SymbolicCommandParseResult } from '../../parsers/types/operator-types.js';
import type { ConvertedPrompt } from '../../types.js';

import { PromptError } from '#shared/utils/index.js';

/**
 * Provider function to get all converted prompts.
 * Ensures fresh data on each access (supports hot-reload).
 */
type PromptsProvider = () => ConvertedPrompt[];

/**
 * Canonical Pipeline Stage 1: Command Parsing
 *
 * Parses incoming commands using UnifiedCommandParser, resolves arguments,
 * and builds symbolic chains for operator-based workflows.
 *
 * Domain logic delegated to:
 * - SymbolicCommandBuilder: symbolic operator → ParsedCommand
 * - ChainBlueprintResolver: session blueprint restoration for response-only mode
 *
 * Dependencies: None (always runs first)
 * Output: context.parsedCommand, context.symbolicChain (if operators detected)
 * Can Early Exit: Yes (if parsing fails)
 */
export class CommandParsingStage extends BasePipelineStage {
  readonly name = 'CommandParsing';

  constructor(
    private readonly commandParser: UnifiedCommandParser,
    private readonly argumentParser: ArgumentParser,
    private readonly promptsProvider: PromptsProvider,
    logger: Logger,
    private readonly symbolicCommandBuilder: SymbolicCommandBuilder,
    private readonly blueprintResolver?: ChainBlueprintResolver
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    if (context.isResponseOnlyMode()) {
      this.logger.debug('[ParsingStage] Response-only mode detected - resuming chain', {
        chainId: context.mcpRequest.chain_id,
        hasUserResponse: Boolean(context.mcpRequest.user_response),
      });
      if (!this.blueprintResolver) {
        this.handleError(
          new Error('ChainBlueprintResolver unavailable for response-only execution')
        );
      }
      this.blueprintResolver.restoreFromBlueprint(context);
      this.logExit({ skipped: 'Response-only session rehydrated' });
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
        const symbolicCommand = await this.symbolicCommandBuilder.buildSymbolicCommand(
          parseResult as SymbolicCommandParseResult,
          (idOrName) => this.findConvertedPrompt(idOrName)
        );

        this.mergeRequestOptions(symbolicCommand.promptArgs, context);

        context.parsedCommand = symbolicCommand;
        this.logExit({
          promptId: parseResult.promptId,
          format: parseResult.format,
          type: 'symbolic',
        });
        return;
      }

      context.parsedCommand = await this.buildDirectCommand(parseResult);

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
   * Build ParsedCommand for non-symbolic (direct) commands.
   */
  private async buildDirectCommand(
    parseResult: import('../../parsers/command-parser.js').CommandParseResult
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

    // Options already baked into command string by Stage 00 (normalizedCommand).
    // mergeRequestOptions only needed for symbolic path (line 91).

    if (convertedPrompt.chainSteps?.length) {
      parsedCommand.commandType = 'chain';
      parsedCommand.steps = convertedPrompt.chainSteps.map((step, index) => {
        const stepConverted = this.findConvertedPrompt(step.promptId);
        if (!stepConverted) {
          throw new PromptError(`Converted prompt data not found for chain step: ${step.promptId}`);
        }

        return {
          stepNumber: index + 1,
          promptId: step.promptId,
          args: (argResult as any).processedArgs,
          variableName: step.stepName ?? `step_${index + 1}`,
          convertedPrompt: stepConverted,
          inputMapping: step.inputMapping,
          outputMapping: step.outputMapping,
          retries: step.retries,
          ...(step.subagentModel != null || stepConverted.subagentModel != null
            ? { subagentModel: step.subagentModel ?? stepConverted.subagentModel }
            : {}),
        } as ChainStepPrompt;
      });
    }

    return parsedCommand;
  }

  /**
   * Merge requestOptions into promptArgs (options parameter from prompt_engine call).
   * Options values override empty/falsy placeholder values from prompt definitions
   * but inline args (truthy values) still take precedence.
   */
  private mergeRequestOptions(
    promptArgs: Record<string, any> | undefined,
    context: ExecutionContext
  ): void {
    const requestOptions = context.state.normalization.requestOptions;
    if (!requestOptions || typeof requestOptions !== 'object' || !promptArgs) {
      return;
    }

    for (const [key, value] of Object.entries(requestOptions)) {
      const existing = promptArgs[key];
      const isFalsyOrEmpty =
        existing === undefined ||
        existing === null ||
        existing === '' ||
        (Array.isArray(existing) && existing.length === 0);
      if (!(key in promptArgs) || isFalsyOrEmpty) {
        promptArgs[key] = value;
      }
    }
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

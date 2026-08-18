// @lifecycle canonical - Builds ParsedCommand structures from symbolic operator parse results.

import type { Logger } from '#infra/logging/index.js';
import type {
  ExecutionContext as ArgumentExecutionContext,
  ArgumentParser,
} from './argument-parser.js';
import type { ShellVerifyGate } from '../../gates/shell/types.js';
import type { ParsedCommand } from '../context/index.js';
import type { ChainStepPrompt } from '../operators/types.js';
import type { ConvertedPrompt } from '../types.js';
import type { SymbolicCommandParseResult } from './types/operator-types.js';

import { PromptError } from '#shared/utils/index.js';

type ParsedArgumentsResult = {
  processedArgs: Record<string, any>;
  resolvedPlaceholders: Record<string, any>;
};

/**
 * Named gate collected from gate operators (:: syntax).
 */
export interface CollectedNamedGate {
  gateId: string;
  criteria: string[];
  shellVerify?: ShellVerifyGate;
}

/**
 * Result of collecting gate criteria from symbolic operators.
 */
export interface CollectedGateCriteria {
  anonymousCriteria: string[];
  namedGates: CollectedNamedGate[];
}

/**
 * Prompt lookup function — provided by the stage from its promptsProvider.
 */
export type PromptLookup = (idOrName: string) => ConvertedPrompt | undefined;

/**
 * Builds structured ParsedCommand from symbolic operator parse results.
 *
 * Handles single-prompt and chain-based symbolic commands, resolving
 * arguments, collecting gate criteria, and linking converted prompts.
 *
 * Extracted from CommandParsingStage.
 */
export class SymbolicCommandBuilder {
  constructor(
    private readonly argumentParser: ArgumentParser,
    private readonly logger: Logger
  ) {}

  /**
   * Build a ParsedCommand from a symbolic parse result.
   * Dispatches to single-prompt or chain builder based on operator presence.
   */
  async buildSymbolicCommand(
    parseResult: SymbolicCommandParseResult,
    findPrompt: PromptLookup
  ): Promise<ParsedCommand> {
    const hasChainOperator = this.hasChainOperator(parseResult);
    if (!hasChainOperator) {
      return this.buildSingleSymbolicPrompt(parseResult, findPrompt);
    }
    return this.buildSymbolicChain(parseResult, findPrompt);
  }

  /**
   * Separates gate operators into named and anonymous criteria.
   * Named gates (with gateId) are returned separately for explicit ID registration.
   * Anonymous criteria are merged together for backward-compatible temp gate creation.
   * Shell verification gates (with shellVerify) are included for Ralph Wiggum loops.
   */
  collectGateCriteria(parseResult: SymbolicCommandParseResult): CollectedGateCriteria {
    const operators = parseResult.operators?.operators;
    if (!Array.isArray(operators)) {
      return { anonymousCriteria: [], namedGates: [] };
    }

    const anonymousCriteria: string[] = [];
    const namedGates: CollectedNamedGate[] = [];

    for (const op of operators) {
      if (op.type !== 'gate') continue;
      const gate = op;

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
        const namedGate: CollectedNamedGate = { gateId: gate.gateId, criteria: cleanedCriteria };

        if (gate.shellVerify) {
          namedGate.shellVerify = gate.shellVerify;
        }

        this.logger.debug('[collectGateCriteria] Created namedGate:', {
          gateId: namedGate.gateId,
          hasShellVerify: Boolean(namedGate.shellVerify),
          shellVerifyCommand: namedGate.shellVerify?.command,
          shellVerifyTimeout: namedGate.shellVerify?.timeout,
          criteria: namedGate.criteria,
        });

        namedGates.push(namedGate);
      } else {
        anonymousCriteria.push(...cleanedCriteria);
      }
    }

    return {
      anonymousCriteria: Array.from(new Set(anonymousCriteria)),
      namedGates,
    };
  }

  private async buildSingleSymbolicPrompt(
    parseResult: SymbolicCommandParseResult,
    findPrompt: PromptLookup
  ): Promise<ParsedCommand> {
    const baseStep = parseResult.executionPlan.steps[0];
    if (!baseStep?.promptId) {
      throw new PromptError('Symbolic command requires a valid prompt identifier.');
    }

    const convertedPrompt = findPrompt(baseStep.promptId);
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
    parseResult: SymbolicCommandParseResult,
    findPrompt: PromptLookup
  ): Promise<ParsedCommand> {
    const stepPrompts: ChainStepPrompt[] = [];
    let commandArgs: Record<string, any> = {};

    const argumentInputs = parseResult.executionPlan.argumentInputs ?? [];

    const { anonymousCriteria: globalGateCriteria, namedGates } =
      this.collectGateCriteria(parseResult);

    // S9: when the parser attributed inline gate criteria to specific steps, every anonymous
    // token lived inside some segment — seeding the command-level inlineGateCriteria from the
    // whole-command anonymousCriteria as well would double-register the same criteria as an
    // orphan execution-scope gate no step reviews. Named gates keep their global handling.
    const stepsCarryInlineGates = parseResult.executionPlan.steps.some(
      (step) => (step.inlineGateCriteria?.length ?? 0) > 0
    );

    for (const [index, step] of parseResult.executionPlan.steps.entries()) {
      if (!step.promptId) {
        continue;
      }

      const convertedPrompt = findPrompt(step.promptId);
      if (!convertedPrompt) {
        throw new PromptError(`Converted prompt data not found for chain step: ${step.promptId}`);
      }

      const stepArgumentInput = argumentInputs[index];
      const fallbackArgs =
        step.args && step.args.trim().length > 0
          ? await this.parseArgumentsSafely(step.args, convertedPrompt)
          : undefined;

      const stepGateCriteria = step.inlineGateCriteria ?? [];

      const resolvedArgs = await this.resolveArgumentPayload(
        convertedPrompt,
        stepArgumentInput,
        stepGateCriteria,
        fallbackArgs?.processedArgs
      );

      if (stepPrompts.length === 0) {
        commandArgs = resolvedArgs.processedArgs;
      }

      stepPrompts.push({
        stepNumber: step.stepNumber ?? stepPrompts.length + 1,
        // Propagated from the ExecutionStep minted upstream in symbolic-operator-parser.ts —
        // never re-minted here (would diverge from the frozen n1..nK if this site's fallback
        // stepNumber path is ever taken for a step the parser didn't number).
        ...(step.nodeId != null ? { nodeId: step.nodeId } : {}),
        promptId: convertedPrompt.id,
        convertedPrompt,
        args: resolvedArgs.processedArgs,
        inlineGateCriteria: resolvedArgs.inlineCriteria,
        ...(step.delegated === true ? { delegated: true } : {}),
        subagentModel: convertedPrompt.subagentModel,
        agentType: convertedPrompt.agentType,
      });
    }

    const parsedCommand: ParsedCommand = {
      ...parseResult,
      steps: stepPrompts,
      promptArgs: commandArgs,
      inlineGateCriteria:
        !stepsCarryInlineGates && globalGateCriteria.length > 0 ? globalGateCriteria : undefined,
    };

    if (namedGates.length > 0) {
      parsedCommand.namedInlineGates = namedGates;
    }
    if (parseResult.executionPlan.styleSelection !== undefined) {
      parsedCommand.styleSelection = parseResult.executionPlan.styleSelection;
    }

    return parsedCommand;
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

    const defaults = this.collectArgumentDefaults(prompt);

    if (!sanitizedArgs?.trim()) {
      if (Object.keys(fallbackArgs ?? {}).length > 0) {
        return {
          processedArgs: { ...defaults, ...fallbackArgs },
          resolvedPlaceholders: {},
          inlineCriteria: normalizedSeed,
        };
      }

      return {
        processedArgs: defaults,
        resolvedPlaceholders: {},
        inlineCriteria: normalizedSeed,
      };
    }

    const parsed = await this.parseArgumentsSafely(sanitizedArgs, prompt);

    const processedArgs =
      parsed.processedArgs && Object.keys(parsed.processedArgs).length > 0
        ? { ...defaults, ...parsed.processedArgs }
        : fallbackArgs
          ? { ...defaults, ...fallbackArgs }
          : defaults;

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
      this.logger.warn('[SymbolicCommandBuilder] Failed to parse symbolic command arguments', {
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
   * Collects default values from prompt argument definitions.
   * Returns a record of { argName: defaultValue } for every argument with a defined default.
   */
  private collectArgumentDefaults(prompt: ConvertedPrompt): Record<string, unknown> {
    const defaults: Record<string, unknown> = {};
    if (prompt.arguments) {
      for (const arg of prompt.arguments) {
        if (arg.defaultValue !== undefined) {
          defaults[arg.name] = arg.defaultValue;
        }
      }
    }
    return defaults;
  }

  private createArgumentContext(): ArgumentExecutionContext {
    return {
      conversationHistory: [],
      environmentVars: process.env as Record<string, string>,
      promptDefaults: {},
      systemContext: {},
    };
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

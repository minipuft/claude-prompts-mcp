// @lifecycle canonical - Builds ParsedCommand structures from symbolic operator parse results.

import type { Logger } from '#infra/logging/index.js';
import type { WorkflowCompilation, WorkflowCompilerDeps } from '#modules/workflow-ir/compiler.js';
import type { WorkflowEdge, WorkflowIR, WorkflowNode } from '#modules/workflow-ir/types.js';
import type {
  ExecutionContext as ArgumentExecutionContext,
  ArgumentParser,
} from './argument-parser.js';
import type { ShellVerifyGate } from '../../gates/shell/types.js';
import type { ParsedCommand } from '../context/index.js';
import type { ConvertedPrompt } from '../types.js';
import type { SymbolicCommandParseResult } from './types/operator-types.js';

import { PromptError } from '#shared/utils/index.js';

/**
 * `compileWorkflowIR`, injected.
 *
 * Same seam and the same reason as `WorkflowIrPort` in `workflow-command-builder.ts`: the
 * compiler lives in `modules/workflow-ir/` (Layer 3) and dependency-cruiser's
 * `engine-no-modules-or-mcp-value` bars `engine/` from value-importing it. The composition root
 * (`PipelineBuilder`) is the one layer that may name both sides. Narrower than `WorkflowIrPort`
 * because a `-->` command needs no validator: its nodes are minted by the parser, not submitted
 * by a client, so there is no untrusted shape to reject and no order to derive — the chain is
 * linear by construction.
 */
export type WorkflowCompileFn = (
  ir: WorkflowIR,
  order: readonly string[],
  deps: WorkflowCompilerDeps
) => WorkflowCompilation;

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
    private readonly logger: Logger,
    private readonly compileWorkflow: WorkflowCompileFn
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

  /**
   * A `-->` command → Workflow IR nodes → `compileWorkflowIR` (row A.2).
   *
   * The string path no longer builds `ChainStepPrompt[]` itself. It builds the same IR a client
   * could have submitted — frozen `n1..nN` ids straight off the parser, linear edges, per-step
   * resolved args, `==>` on `delegated`, per-step `::` tokens on `inlineGateCriteria` — and hands
   * it to the one compiler YAML (through A.1's derivation) and a submitted IR already reach. One
   * projection rule, three inputs; before this there were two copies of it and nothing failed
   * when they diverged.
   *
   * WHAT STAYS HERE AND WHY. Two things happen before compilation rather than inside it, and both
   * are deliberate:
   *
   *   - ARGUMENT RESOLUTION. A symbolic step's args are a fragment of a command STRING, routinely
   *     partial, and `resolveArgumentPayload` runs them through the full `ArgumentParser` ladder
   *     plus the prompt's declared defaults. An IR node's `args` is a declared object the
   *     validator has already checked, which is why `compileNode` does not re-derive defaults.
   *     Resolving first and putting the RESULT on the node keeps both true.
   *   - THE PROMPT-LEVEL `subagentModel` / `agentType` FALLBACK. It has always been read off the
   *     resolved prompt on this path and has never existed on the IR path. Unifying the two was
   *     priced and KILLED (OQ-A2b): an IR run would gain a fallback it never had. So it is applied
   *     here, onto the node, and `compileNode` still copies no prompt defaults.
   *
   * `findPrompt` is still resolved BEFORE compiling, and still throws `PromptError` for a step
   * whose prompt is unregistered. `compileWorkflowIR` would throw `WorkflowCompileError` for the
   * same miss, but that error means "an unvalidated IR reached the compiler" — a server fault —
   * and a mistyped prompt id in a user's `-->` command is not one.
   */
  private async buildSymbolicChain(
    parseResult: SymbolicCommandParseResult,
    findPrompt: PromptLookup
  ): Promise<ParsedCommand> {
    const nodes: WorkflowNode[] = [];
    const order: string[] = [];
    const promptsById = new Map<string, ConvertedPrompt>();

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

      // Frozen at mint by `symbolic-operator-parser.generateExecutionPlan`, never re-minted here:
      // a locally derived id would diverge from the `n1..nK` the rest of the run addresses. The
      // fallback covers only a step the parser did not number, which its own chain path cannot
      // produce — it exists so an unnumbered step fails as a duplicate id rather than silently
      // losing its identity.
      const nodeId = step.nodeId ?? `n${nodes.length + 1}`;
      promptsById.set(convertedPrompt.id, convertedPrompt);
      order.push(nodeId);
      nodes.push({
        id: nodeId,
        promptId: convertedPrompt.id,
        args: resolvedArgs.processedArgs,
        // Written even when empty: this path has always put an `inlineGateCriteria` array on
        // every step, and `compileNode` spreads what it is given. An absent key and an empty
        // array are the same to `InlineGateProcessor` but not to a reader doing `.length`.
        inlineGateCriteria: resolvedArgs.inlineCriteria,
        ...(step.delegated === true ? { delegated: true } : {}),
        // The prompt-level fallback OQ-A2b kept path-local. See the method docblock.
        ...(convertedPrompt.subagentModel !== undefined
          ? { subagentModel: convertedPrompt.subagentModel }
          : {}),
        ...(convertedPrompt.agentType !== undefined
          ? { agentType: convertedPrompt.agentType }
          : {}),
      });
    }

    // Linear by construction — a `-->` command declares a sequence, not a dependency graph. The
    // edges are carried on the IR because they are part of the representation this command now
    // HAS; `compileWorkflowIR` consumes `order`, which for a hand-written linear IR is the same
    // list the linearizer would return.
    const edges: WorkflowEdge[] = order
      .slice(1)
      .map((to, index) => ({ from: order[index] as string, to }));

    const compilation = this.compileWorkflow(
      { version: 1, nodes, ...(edges.length > 0 ? { edges } : {}) },
      order,
      { lookupPrompt: (promptId) => promptsById.get(promptId) ?? findPrompt(promptId) }
    );

    const parsedCommand: ParsedCommand = {
      ...parseResult,
      steps: compilation.steps,
      promptArgs: compilation.promptArgs,
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
      // Empty args resolve through ArgumentParser, not through collectArgumentDefaults alone.
      // That helper reads author-declared `defaultValue` only, while the parser's fallback
      // strategy (`canHandle: () => true`) resolves EVERY declared argument through the full
      // ladder: author default -> promptDefaults -> environment -> `{value:'', empty_fallback}`.
      // The direct command path has always gone through the parser, so returning the narrower
      // set here made one prompt render two ways depending on whether a symbolic operator was
      // present: `>>reference_demo` rendered text="" while `>>reference_demo :: code-quality`
      // dropped `text` and failed its script tool's input validation. The empty-args case is
      // the ONLY one a gate-token-only command produces, which is why attaching a gate to any
      // prompt whose arguments are all optional-or-defaulted was a latent failure.
      const resolved = await this.parseArgumentsSafely('', prompt);
      return {
        processedArgs: { ...resolved.processedArgs, ...defaults, ...(fallbackArgs ?? {}) },
        resolvedPlaceholders: resolved.resolvedPlaceholders,
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
    // No empty-string short-circuit. An empty argument string is a REAL case the parser
    // answers (its fallback strategy resolves every declared argument), and returning `{}`
    // here would silently defeat the empty-args path above — the guard stood exactly where
    // the defect was.
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

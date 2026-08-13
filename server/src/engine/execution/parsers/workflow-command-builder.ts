// @lifecycle canonical - Builds ParsedCommand structures from submitted Workflow IR (P6 Tier 5).
/**
 * Workflow IR → `ParsedCommand`.
 *
 * The THIRD command source, beside `SymbolicCommandBuilder` (`>>a --> >>b`) and
 * `CommandParsingStage.buildDirectCommand` (`>>chain`). It is a sibling of those two by
 * ownership, not a new pipeline: the Domain Ownership Matrix assigns command parsing to
 * `execution/parsers/`, and `ParsedCommand` is built nowhere else.
 *
 * WHY THE IR SERVICES ARE INJECTED RATHER THAN IMPORTED. `validateWorkflowIR`,
 * `linearize` and `compileWorkflowIR` live in `modules/workflow-ir/` (Layer 3), and
 * dependency-cruiser's `engine-no-modules-or-mcp-value` bars `engine/` (Layer 2) from
 * value-importing them — an error-severity rule, not a warning. The composition root that already
 * spans both layers, `PipelineBuilder` (`mcp/`, Layer 4), supplies them through
 * {@link WorkflowIrPort}. Type-only imports of the IR vocabulary are permitted and warn-tracked,
 * the same posture the four stages that type-import `ExecutionRecordStore` already carry.
 *
 * WHY THE SHAPE MIRRORS A SYMBOLIC CHAIN, NOT A YAML CHAIN. A YAML chain's `ParsedCommand` carries
 * a root `convertedPrompt` because a chain RESOURCE exists. A submitted IR has no resource, and
 * `SymbolicCommandBuilder.buildSymbolicChain` is the existing precedent for exactly that
 * situation: it emits `steps` with no root `convertedPrompt` and everything downstream —
 * `buildChainNodes`, the base chain id, the renderers — already handles it. Fabricating a
 * synthetic chain `ConvertedPrompt` here would invent a resource the run does not have, which is
 * how an IR-specific execution path starts.
 */

import type { Logger } from '#infra/logging/index.js';
import type { WorkflowCompilation, WorkflowCompilerDeps } from '#modules/workflow-ir/compiler.js';
import type {
  WorkflowIR,
  WorkflowRejection,
  WorkflowValidation,
} from '#modules/workflow-ir/types.js';
import type { WorkflowValidatorDeps } from '#modules/workflow-ir/validator.js';
import type { PromptLookup } from './symbolic-command-builder.js';
import type { ParsedCommand } from '../context/index.js';

/**
 * The `modules/workflow-ir/` surface this builder consumes, supplied by the composition root.
 *
 * One port with two members rather than two injected callbacks: validation returns the order
 * compilation consumes, so wiring them from two places would let a caller compile under an order
 * a different validator produced.
 */
export interface WorkflowIrPort {
  validate(ir: WorkflowIR, deps: WorkflowValidatorDeps): WorkflowValidation;
  compile(
    ir: WorkflowIR,
    order: readonly string[],
    deps: WorkflowCompilerDeps
  ): WorkflowCompilation;
}

/** Discriminated build result. Mirrors the module's own `{ok:true}|{ok:false, rejections[]}`. */
export type WorkflowCommandResult =
  | { readonly ok: true; readonly parsedCommand: ParsedCommand }
  | { readonly ok: false; readonly rejections: readonly WorkflowRejection[] };

/**
 * Builds a `ParsedCommand` from a submitted Workflow IR.
 *
 * Stateless beyond its injected collaborators — nothing is cached between calls and nothing is
 * held per connection. That is load-bearing under transport parity: Streamable HTTP rebuilds the
 * whole server per request, so any IR state hung off this object would exist on STDIO and vanish
 * on HTTP.
 */
export class WorkflowCommandBuilder {
  constructor(
    private readonly workflowIr: WorkflowIrPort,
    private readonly logger: Logger
  ) {}

  /**
   * Validate, linearize and compile one submission.
   *
   * Returns rejections rather than throwing: a malformed IR is a client error with an addressed
   * explanation, not a server fault, and the caller (stage 04) turns it into a response BEFORE
   * any store is touched. Throwing would route it through the pipeline's error boundary instead,
   * which is the path that emits a terminal execution record.
   */
  build(ir: WorkflowIR, findPrompt: PromptLookup): WorkflowCommandResult {
    const validation = this.workflowIr.validate(ir, {
      lookupPrompt: (promptId) => {
        const converted = findPrompt(promptId);
        if (converted === undefined) {
          return undefined;
        }
        return {
          requiredArguments: converted.arguments
            .filter((argument) => argument.required === true)
            .map((argument) => argument.name),
        };
      },
    });

    if (!validation.ok) {
      this.logger.debug('[WorkflowCommandBuilder] Rejected workflow submission', {
        rejections: validation.rejections.length,
        reasons: validation.rejections.map((rejection) => rejection.reason),
      });
      return { ok: false, rejections: validation.rejections };
    }

    const compilation = this.workflowIr.compile(ir, validation.order, {
      lookupPrompt: findPrompt,
    });

    const firstStep = compilation.steps[0];
    if (firstStep === undefined) {
      // Unreachable through the validator, which rejects an empty node list with
      // `empty-workflow`. Kept as a typed guard rather than a non-null assertion so a future
      // validator change surfaces here instead of producing a `ParsedCommand` with no promptId.
      return {
        ok: false,
        rejections: [
          {
            reason: 'empty-workflow',
            detail: 'Workflow compiled to zero steps',
          },
        ],
      };
    }

    const parsedCommand: ParsedCommand = {
      // The first step's prompt id, mirroring a symbolic chain's `parseResult.promptId`. This is
      // what `SessionManagementStage.getBaseChainId` falls back to, so an IR run's base chain id
      // reads `chain-<first prompt>` exactly as the equivalent symbolic chain's does.
      promptId: firstStep.promptId,
      rawArgs: '',
      format: 'structured',
      confidence: 1,
      commandType: 'chain',
      metadata: {
        originalCommand: WORKFLOW_COMMAND_LABEL,
        parseStrategy: 'workflow-ir',
        detectedFormat: 'workflow-ir',
        warnings: [],
      },
      steps: compilation.steps,
      promptArgs: compilation.promptArgs,
      ...(compilation.budget !== undefined ? { budget: compilation.budget } : {}),
    };

    this.logger.debug('[WorkflowCommandBuilder] Compiled workflow submission', {
      nodes: compilation.steps.length,
      order: validation.order,
    });

    return { ok: true, parsedCommand };
  }
}

/**
 * Stand-in for the command string an IR submission does not have.
 *
 * `metadata.originalCommand` is read by diagnostics and by the temporary-gate registrar's log
 * line, both of which expect a non-empty label. A literal is used rather than a serialized IR:
 * the submission can be up to 32 nodes, and a log line is not a place to reproduce it.
 */
export const WORKFLOW_COMMAND_LABEL = '<workflow-ir>';

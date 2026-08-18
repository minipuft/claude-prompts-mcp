// @lifecycle canonical - Framework validation operations: scoring, error formatting, success formatting.

import type { ToolResponse } from '#shared/types/index.js';
import type { FrameworkCreationData, FrameworkDraftValidationResult } from '../core/types.js';

import { ResourceVerificationService } from '#modules/resources/services/index.js';

/** Worked examples, one per field that can be reported missing OR reported malformed. */
const FIELD_EXAMPLES: ReadonlyArray<{ field: string; example: unknown }> = [
  {
    field: 'phases',
    example: [
      { id: 'analyze', name: 'Analyze', description: 'Understand the problem' },
      { id: 'design', name: 'Design', description: 'Plan the solution' },
      { id: 'implement', name: 'Implement', description: 'Build the solution' },
    ],
  },
  {
    field: 'framework_gates',
    example: [
      {
        id: 'analysis-complete',
        name: 'Analysis Gate',
        description: 'Validates analysis phase',
        frameworkArea: 'analysis',
        priority: 'high',
        validationCriteria: ['Problem clearly defined', 'Constraints identified'],
      },
    ],
  },
  {
    field: 'template_suggestions',
    example: [
      {
        section: 'system',
        type: 'addition',
        description: 'State the framework phases up front',
        content: '## Phases\n1. Analyze\n2. Design',
        impact: 'high',
      },
    ],
  },
];

/** Which draft fields carry usable content — the one reading the score and the errors share. */
interface DraftCoverage {
  guidance: boolean;
  phases: boolean;
  gates: boolean;
  elements: boolean;
  templateSuggestions: boolean;
  description: boolean;
}

export class FrameworkDraftValidator {
  /**
   * The tool layer's sanctioned route to resource-content validation.
   *
   * `.dependency-cruiser.cjs` (`tool-layer-no-validator-value-imports`, severity error) forbids
   * `src/mcp/tools/**` from value-importing a resource schema and names this service as the
   * replacement. Defaulted so every existing `new FrameworkDraftValidator()` call site is
   * unchanged; injectable so a test can supply a spy.
   */
  constructor(
    private readonly verificationService: ResourceVerificationService = new ResourceVerificationService()
  ) {}

  /**
   * Validate framework with strict requirements.
   *
   * Required fields (80% threshold):
   * - system_prompt_guidance (core LLM guidance)
   * - phases (framework structure)
   * - framework_gates (quality validation)
   *
   * Returns structured errors for focused user guidance.
   *
   * ELEMENT SHAPE IS CHECKED HERE, not only after the write. Until 2026-08-18 this method proved
   * `Array.isArray(x) && x.length > 0` for `framework_gates` and never inspected an entry, while
   * the post-write verifier ran `FrameworkGateSchema` over every entry and required `id` AND
   * `name`. A draft carrying `[{ id, description }]` therefore scored 80, passed here, was
   * written to disk, and was rejected by `validateFile` inside `ResourceMutationTransaction` —
   * which rolled the files back and reported only that the state was invalid. The two layers
   * disagreed about the same payload, and the operator learned it from a rollback.
   *
   * The verifier is not the deviation: all 8 shipped frameworks satisfy it, and
   * `RuntimeFrameworkLoader` (`validateOnLoad` defaults true) runs the same schema at load, so
   * relaxing the verifier would only move the rejection to registration. What was wrong is that
   * this method hard-required a field whose shape it declined to check.
   */
  validate(data: FrameworkCreationData): FrameworkDraftValidationResult {
    const coverage = this.measureCoverage(data);

    const errors = this.collectErrors(data, coverage);
    // RECOMMENDED fields - only warn if passed required checks
    const warnings = errors.length === 0 ? this.collectWarnings(data, coverage) : [];
    const score = this.computeScore(coverage);

    const level: 'incomplete' | 'standard' | 'full' =
      score >= 80 ? 'full' : score >= 50 ? 'standard' : 'incomplete';
    const valid = errors.length === 0;

    return {
      valid,
      score,
      level,
      errors,
      warnings,
      nextStep: errors[0] ?? warnings[0],
    };
  }

  /**
   * Create structured error response for validation failures.
   *
   * Shows the focused error, every other error found in the same pass, and a worked example of
   * the field the first error names.
   *
   * The example used to be reachable ONLY from a "<field> is required" message, so a caller who
   * supplied `framework_gates` with an under-specified entry got no example and no shape to
   * conform to — and `framework_gates` is not a declared parameter on `resourceManagerInputSchema`
   * or in `tooling/contracts/resource-manager.json` (it arrives through `.passthrough()`), so
   * this response was and remains the only published statement of its element shape. Selecting
   * the example by the FIELD NAME appearing in the error covers both cases with one rule: the
   * absent message says `framework_gates is required …`, the malformed one says
   * `framework_gates[0].name: …`.
   */
  createErrorResponse(id: string, validation: FrameworkDraftValidationResult): ToolResponse {
    const [firstError, ...otherErrors] = validation.errors;

    let message = `❌ Framework '${id}' validation failed (${validation.score}% field coverage)\n\n`;
    message += `**Issue:** ${firstError}\n\n`;

    if (otherErrors.length > 0) {
      message += `**Also:**\n${otherErrors.map((error) => `  • ${error}`).join('\n')}\n\n`;
    }

    const example = FIELD_EXAMPLES.find(
      (candidate) => firstError?.includes(candidate.field) === true
    );
    if (example !== undefined) {
      message += `**Example ${example.field}:**\n\`\`\`json\n${JSON.stringify(
        example.example,
        null,
        2
      )}\n\`\`\``;
    }

    return { content: [{ type: 'text', text: message }], isError: true };
  }

  /**
   * Format validation result into human-readable success message.
   */
  formatSuccess(id: string, validation: FrameworkDraftValidationResult, paths: string[]): string {
    // `level` is not printed: `validate()` requires guidance + phases + gates, worth
    // 30 + 30 + 20, so any valid draft scores >= 80 and `level` is invariably 'full'. A word
    // that cannot vary carries no information while implying completeness — directly above a
    // Recommendations list naming what is missing. The unit is stated for the same reason it
    // was added to the error header: `measureCoverage` is presence-only.
    let message = `✅ Framework '${id}' created (${validation.score}% field coverage)`;
    message +=
      validation.warnings.length > 0
        ? ` — ${validation.warnings.length} recommendation(s)\n\n`
        : `\n\n`;
    message += `**Files:**\n${paths.map((p) => `  • ${p}`).join('\n')}\n\n`;

    if (validation.warnings.length > 0) {
      message += `**Recommendations:**\n${validation.warnings
        .slice(0, 3)
        .map((w) => `  • ${w}`)
        .join('\n')}`;
    }

    return message;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Which draft fields carry usable content. Computed once so the error chain, the score and the
   * warnings all read the same answer — they previously each re-derived `?.trim()` and
   * `length > 0` inline, which is most of what put `validate` over the cognitive limit.
   */
  private measureCoverage(data: FrameworkCreationData): DraftCoverage {
    return {
      guidance: (data.system_prompt_guidance ?? '').trim() !== '',
      phases: Array.isArray(data.phases) && data.phases.length > 0,
      gates: Array.isArray(data.framework_gates) && data.framework_gates.length > 0,
      elements: data.framework_elements !== undefined,
      templateSuggestions:
        data.template_suggestions !== undefined && data.template_suggestions.length > 0,
      description: (data.description ?? '').trim() !== '',
    };
  }

  /** Blocking errors: the required-field chain first, element shape once presence is satisfied. */
  private collectErrors(data: FrameworkCreationData, coverage: DraftCoverage): string[] {
    // One at a time, for focused feedback.
    if (!coverage.guidance) {
      return ['system_prompt_guidance is required - defines core LLM guidance'];
    }
    if (!coverage.phases) {
      return ['phases is required - defines framework structure'];
    }
    if (!coverage.gates) {
      return ['framework_gates is required - enables quality validation'];
    }
    // Presence is satisfied; now check the shape the post-write verifier will demand. Only
    // reached once the required fields are all present, so the "one focused error at a time"
    // progression for MISSING fields is unchanged.
    return this.validateElementShapes(data);
  }

  /** Non-blocking recommendations. Only meaningful once the blocking errors are clear. */
  private collectWarnings(data: FrameworkCreationData, coverage: DraftCoverage): string[] {
    const warnings: string[] = [];
    if (!coverage.elements) {
      warnings.push('Add framework_elements for structured prompt guidance');
    }
    if (!coverage.templateSuggestions) {
      warnings.push('Add template_suggestions for system/user prompt hints');
    }
    if (!coverage.description) {
      warnings.push('Add description for framework overview');
    }
    return warnings;
  }

  /** Field-coverage score, 0-100. Weights unchanged. */
  private computeScore(coverage: DraftCoverage): number {
    return (
      (coverage.guidance ? 30 : 0) +
      (coverage.phases ? 30 : 0) +
      (coverage.gates ? 20 : 0) +
      (coverage.elements ? 10 : 0) +
      (coverage.templateSuggestions ? 5 : 0) +
      (coverage.description ? 5 : 0)
    );
  }

  /**
   * Delegate element-shape checking to the verification service, then render its issues the way
   * this class renders every other error — one string per problem, `<path>: <expectation>`.
   *
   * `formatIssues` is the same renderer the post-write failure payload uses, so a caller sees the
   * same sentence whichever layer catches the problem. An empty or absent array yields nothing:
   * presence is the caller's concern above, and `template_suggestions` is optional, so an omitted
   * one is a warning there rather than an error here.
   */
  private validateElementShapes(data: FrameworkCreationData): string[] {
    return this.verificationService.formatIssues(
      this.verificationService.validateFrameworkDraftElements(
        data as unknown as Record<string, unknown>
      )
    );
  }
}

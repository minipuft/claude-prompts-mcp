// @lifecycle canonical - Renders gate guidance text for prompts/chains.
/**
 * Gate Guidance Renderer - User-Facing Guidance Generation
 *
 * Single responsibility: Generate and format gate guidance for users.
 */

import { REMINDER_CHARS_PER_TOKEN } from '../constants.js';
import { filterFrameworkGuidance, hasFrameworkSpecificContent } from './FrameworkGuidanceFilter.js';
import { deriveGateTier, formatCheckLine } from '../core/gate-tier.js';

import type { Logger } from '#infra/logging/index.js';
import type { GateContext } from '../core/gate-definitions.js';
import type { GateDefinitionProvider } from '../core/gate-loader.js';
import type { TemporaryGateRegistry } from '../core/temporary-gate-registry.js';
import type { GateActivationContext, LightweightGateDefinition } from '../types.js';

import { DEFAULT_GATES_CONFIG } from '#shared/types/core-config.js';

/**
 * The slice of `gates` config this renderer reads. Narrower than `GateSystemSettings` on purpose:
 * `ConfigManager.getGatesConfig()` satisfies it structurally, and a test can supply a literal.
 */
export interface GateGuidanceConfig {
  harnessCovers?: readonly string[];
  reminderTokenBudget?: number;
}

/**
 * Closing attestation line for chain criteria delivery — the canonical renderer here and the
 * fallback in chain-operator-executor.ts. Guidance-only delivery carries an advisory caveat.
 * Exported so the fallback imports this literal instead of carrying its own copy that can drift.
 */
export const GATE_ATTESTATION_LINE =
  "Attest reminders in the verdict's `reminders` field; checks are recorded by the engine.";

const GATE_ADVISORY_LINE =
  'Use these gates as advisory guidance. Their criteria are not executed for single prompts.';

export interface GateGuidanceRendererOptions {
  gateLoader: GateDefinitionProvider;
  temporaryGateRegistry?: TemporaryGateRegistry;
  frameworkIdentifierProvider?: () => readonly string[] | undefined;
  /**
   * Reads the live `gates` config. A provider, not a snapshot: `system_control` can change
   * `gates.harnessCovers` / `gates.reminderTokenBudget` at runtime, and a value captured at
   * construction would pin the renderer to the config that existed at server start. Same shape
   * as `frameworkIdentifierProvider` above and as `GatesConfigProvider` in the pipeline stages.
   */
  gatesConfigProvider?: () => GateGuidanceConfig | undefined;
}

/** Severity ordering weights, most severe first. */
const SEVERITY_ORDER: Record<NonNullable<LightweightGateDefinition['severity']>, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** A reminder gate that survived harnessCovers suppression, ready to be budgeted. */
interface ReminderEntry {
  gate: LightweightGateDefinition;
  explicit: boolean;
  /** Full rendered section (`### Name` + guidance) — what a non-degraded reminder emits. */
  rendered: string;
  /** Coarse token estimate of `rendered`; the budget is a ceiling, not a measurement. */
  tokens: number;
  /** Position in the caller's `gateIds`, the final tiebreak so ordering stays stable. */
  inputOrder: number;
}

type GateGuidanceEntry =
  | { kind: 'check'; line: string }
  | { kind: 'reminder'; reminder: ReminderEntry }
  | { kind: 'suppressed' }
  | { kind: 'skipped' };

/** Ordering weight for a reminder's severity; an unset severity sorts as `medium`. */
function severityWeight(severity: LightweightGateDefinition['severity']): number {
  return SEVERITY_ORDER[severity ?? 'medium'];
}

/**
 * Gate guidance renderer with framework-specific filtering and temporary gate support
 */
export class GateGuidanceRenderer {
  private readonly logger: Logger;
  private readonly gateLoader: GateDefinitionProvider;
  private readonly temporaryGateRegistry: TemporaryGateRegistry | undefined;
  private readonly frameworkIdentifierProvider: (() => readonly string[] | undefined) | undefined;
  private readonly gatesConfigProvider: (() => GateGuidanceConfig | undefined) | undefined;

  constructor(logger: Logger, options: GateGuidanceRendererOptions) {
    if (!options?.gateLoader) {
      throw new Error('GateGuidanceRenderer requires a gate loader/provider instance');
    }

    this.logger = logger;
    this.gateLoader = options.gateLoader;
    this.temporaryGateRegistry = options.temporaryGateRegistry;
    this.frameworkIdentifierProvider = options.frameworkIdentifierProvider;
    this.gatesConfigProvider = options.gatesConfigProvider;

    if (this.temporaryGateRegistry) {
      this.logger.debug('[GATE GUIDANCE RENDERER] Temporary gate registry enabled');
    }
    this.logger.debug('[GATE GUIDANCE RENDERER] Initialized with shared gate provider cache');
  }

  /**
   * Generate formatted gate guidance for display to users
   *
   * @param gateIds - Array of gate IDs to render
   * @param context - Context for gate activation and framework filtering
   * @returns Formatted guidance text ready for display
   */
  async renderGuidance(gateIds: string[], context: GateContext = {}): Promise<string> {
    this.logger.info('🎨 [GATE GUIDANCE RENDERER] renderGuidance called:', {
      gateIds,
      framework: context.framework,
      category: context.category,
    });

    if (gateIds.length === 0) {
      this.logger.debug('[GATE GUIDANCE RENDERER] No gates provided, returning empty guidance');
      return '';
    }

    const { harnessCovers, reminderTokenBudget } = this.resolveGuidanceConfig();
    const criteriaExecute = context.criteriaExecution === 'pipeline';
    const checkLines: string[] = [];
    const reminders: ReminderEntry[] = [];
    const explicitSet = new Set(context.explicitGateIds ?? []);
    let suppressedCount = 0;

    for (const [inputOrder, gateId] of gateIds.entries()) {
      try {
        const entry = await this.collectGateGuidance(
          gateId,
          inputOrder,
          context,
          explicitSet.has(gateId),
          harnessCovers
        );
        switch (entry.kind) {
          case 'check':
            checkLines.push(entry.line);
            break;
          case 'reminder':
            reminders.push(entry.reminder);
            break;
          case 'suppressed':
            suppressedCount += 1;
            break;
          case 'skipped':
            break;
        }
      } catch (error) {
        this.logger.warn('[GATE GUIDANCE RENDERER] Failed to load gate:', gateId, error);
      }
    }

    if (checkLines.length === 0 && reminders.length === 0) {
      this.logger.debug(
        '[GATE GUIDANCE RENDERER] No applicable gates found, returning empty guidance'
      );
      return '';
    }

    const {
      lines: reminderLines,
      fullCount,
      degradedCount,
    } = this.budgetReminders(reminders, reminderTokenBudget);

    const sections: string[] = ['\n\n---\n\n## Inline Gates'];

    // Checks first: they state ground truth the agent cannot argue with.
    if (checkLines.length > 0) {
      sections.push('\n\n### Checks\n\n');
      sections.push([...new Set(checkLines)].join('\n'));
    }

    if (reminderLines.length > 0) {
      sections.push('\n\n### Reminders\n\n');
      sections.push([...new Set(reminderLines)].join('\n\n'));
    }

    sections.push('\n\n' + (criteriaExecute ? GATE_ATTESTATION_LINE : GATE_ADVISORY_LINE));

    sections.push('\n\n---');

    const supplementalGuidance = sections.join('');

    this.logger.debug('[GATE GUIDANCE RENDERER] Generated supplemental guidance:', {
      checkCount: checkLines.length,
      reminderFullCount: fullCount,
      reminderDegradedCount: degradedCount,
      reminderSuppressedCount: suppressedCount,
      guidanceLength: supplementalGuidance.length,
    });

    return supplementalGuidance;
  }

  /** Resolve one gate's delivery without mixing classification with section assembly. */
  private async collectGateGuidance(
    gateId: string,
    inputOrder: number,
    context: GateContext,
    isExplicit: boolean,
    harnessCovers: readonly string[]
  ): Promise<GateGuidanceEntry> {
    const gate = await this.loadGateDefinition(gateId);
    if (gate === null) {
      this.logger.debug('[GATE GUIDANCE RENDERER] Failed to load gate:', gateId);
      return { kind: 'skipped' };
    }

    const inline = this.isInlineGate(gateId, gate) || isExplicit;
    if (!inline && !this.isGateActive(gate, context, isExplicit)) {
      this.logger.debug('[GATE GUIDANCE RENDERER] Skipped gate (not applicable):', gateId);
      return { kind: 'skipped' };
    }

    // Check lines are never suppressed or budgeted. Their classification does not establish
    // execution: single prompts keep the configured command visible with an explicit caveat.
    if (deriveGateTier(gate) === 'check') {
      const checkLine = formatCheckLine(gate.name, gate.pass_criteria ?? []);
      this.logger.debug('[GATE GUIDANCE RENDERER] Added check line for gate:', gateId);
      return {
        kind: 'check',
        line:
          context.criteriaExecution === 'pipeline' ? checkLine : `${checkLine} (not executed here)`,
      };
    }

    // Harness coverage outranks explicit reminder requests (B2); a missing subject is not
    // coverable. Checks took their separate branch above and are unaffected.
    if (
      gate.subject !== undefined &&
      gate.subject.length > 0 &&
      harnessCovers.includes(gate.subject)
    ) {
      this.logger.debug(
        '[GATE GUIDANCE RENDERER] Suppressed reminder covered by harness:',
        gateId,
        gate.subject
      );
      return { kind: 'suppressed' };
    }

    const rendered = this.formatGateGuidance(gate, context);
    this.logger.debug('[GATE GUIDANCE RENDERER] Added guidance for gate:', gateId);
    return {
      kind: 'reminder',
      reminder: {
        gate,
        explicit: isExplicit,
        rendered,
        tokens: Math.ceil(rendered.length / REMINDER_CHARS_PER_TOKEN),
        inputOrder,
      },
    };
  }

  /**
   * Resolve the `gates` settings this renderer reads, calling the provider on every render so a
   * runtime `system_control` config change takes effect without rebuilding the renderer.
   */
  private resolveGuidanceConfig(): {
    harnessCovers: readonly string[];
    reminderTokenBudget: number;
  } {
    const gatesConfig = this.gatesConfigProvider?.();
    // No provider means no wiring, not a second opinion about what the defaults are:
    // `DEFAULT_GATES_CONFIG` is the same object `ConfigManager` folds into `getGatesConfig()`,
    // so an unwired renderer and a wired one with an empty config.json render identically.
    return {
      harnessCovers: gatesConfig?.harnessCovers ?? DEFAULT_GATES_CONFIG.harnessCovers,
      reminderTokenBudget:
        gatesConfig?.reminderTokenBudget ?? DEFAULT_GATES_CONFIG.reminderTokenBudget,
    };
  }

  /**
   * Fit reminders into `reminderTokenBudget` by DEGRADING, never dropping (ruling B10): once the
   * next reminder would push the running total past the budget, it and every later reminder
   * collapse to a one-line name + description. Ordering decides who keeps full guidance —
   * explicitly requested first, then severity descending, then the caller's own order.
   */
  private budgetReminders(
    reminders: ReminderEntry[],
    reminderTokenBudget: number
  ): { lines: string[]; fullCount: number; degradedCount: number } {
    const ordered = [...reminders].sort((a, b) => {
      if (a.explicit !== b.explicit) {
        return a.explicit ? -1 : 1;
      }
      const severityDelta = severityWeight(a.gate.severity) - severityWeight(b.gate.severity);
      if (severityDelta !== 0) {
        return severityDelta;
      }
      return a.inputOrder - b.inputOrder;
    });

    const lines: string[] = [];
    let usedTokens = 0;
    let degrading = false;
    let fullCount = 0;

    for (const entry of ordered) {
      const fits =
        !degrading && reminderTokenBudget > 0 && usedTokens + entry.tokens <= reminderTokenBudget;
      if (fits) {
        usedTokens += entry.tokens;
        fullCount += 1;
        lines.push(entry.rendered);
        continue;
      }
      degrading = true;
      lines.push(`- **${entry.gate.name}** — ${entry.gate.description ?? ''}`.trimEnd());
    }

    return { lines, fullCount, degradedCount: ordered.length - fullCount };
  }

  private isInlineGate(gateId: string, gate: LightweightGateDefinition): boolean {
    // Auto-generated inline gates
    if (gateId.startsWith('inline_gate_')) {
      return true;
    }

    // User-provided temporary gates (should always display, bypass activation checks)
    if (gateId.startsWith('temp_') || this.temporaryGateRegistry?.getTemporaryGate(gateId)) {
      return true;
    }

    // Gates explicitly named as inline quality criteria
    const normalizedName = gate.name?.toLowerCase() ?? '';
    return normalizedName.includes('inline quality') || normalizedName.includes('inline gate');
  }

  /**
   * Load gate definition via the shared gate loader
   *
   * Note: GateLoader already checks the temporary registry, so no fallback needed here.
   * This eliminates duplication and trusts the loader to handle all gate sources.
   */
  private async loadGateDefinition(gateId: string): Promise<LightweightGateDefinition | null> {
    const gate = await this.gateLoader.loadGate(gateId);

    if (!gate) {
      this.logger.warn('[GATE GUIDANCE RENDERER] Gate definition not found:', gateId);
    }

    return gate;
  }

  /**
   * Check if gate should be activated for current context
   *
   * Framework gates (gate_type: "framework") bypass category checks and activate
   * based on framework context alone. This ensures framework guidance
   * applies universally across all categories.
   */
  private isGateActive(
    gate: LightweightGateDefinition,
    context: GateContext,
    explicit: boolean = false
  ): boolean {
    const activationContext: GateActivationContext = { explicitRequest: explicit };
    if (context.category) {
      activationContext.promptCategory = context.category;
    }
    if (context.framework) {
      activationContext.framework = context.framework;
    }
    // B13: activation here must ask the same question the resolver asked, or an artifact-scoped
    // gate is selected at rank 20 and then silently dropped at render.
    if (context.artifacts !== undefined && context.artifacts.length > 0) {
      activationContext.artifacts = context.artifacts;
    }
    return this.gateLoader.isGateActive(gate, activationContext);
  }

  /**
   * Format gate guidance for display with framework-specific filtering
   */
  private formatGateGuidance(gate: LightweightGateDefinition, context: GateContext): string {
    // Trimmed here, not at load: `GateDefinitionLoader` inlines `guidance.md` verbatim (so
    // resource_manager can write it back byte-for-byte), which means a Prettier-formatted file's
    // trailing newline now reaches this method. Rendering is display-only — nothing here feeds a
    // write-back — so trimming for display keeps the section spacing below unchanged from before
    // that fix, one blank line between gates rather than two.
    let guidance = (gate.guidance ?? '').trim();
    const frameworkNames = this.frameworkIdentifierProvider?.();

    if (context.framework && hasFrameworkSpecificContent(guidance, frameworkNames)) {
      guidance = filterFrameworkGuidance(guidance, context.framework, frameworkNames);
      this.logger.debug(
        '[GATE GUIDANCE RENDERER] Applied framework filtering for:',
        context.framework
      );
    }

    // Skip header for auto-generated inline gates - they're already under the section header
    if (gate.name === 'Inline Quality Criteria' || gate.name === 'Inline Validation Criteria') {
      return guidance;
    }

    return `### ${gate.name}\n${guidance}`;
  }

  /**
   * Get detailed gate definitions for listing/discovery
   */
  async getAvailableGateDefinitions(): Promise<LightweightGateDefinition[]> {
    return this.gateLoader.listAvailableGateDefinitions();
  }
}

/**
 * Factory function for creating gate guidance renderer
 */
export function createGateGuidanceRenderer(
  logger: Logger,
  options: GateGuidanceRendererOptions
): GateGuidanceRenderer {
  return new GateGuidanceRenderer(logger, options);
}

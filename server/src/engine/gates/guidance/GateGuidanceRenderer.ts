// @lifecycle canonical - Renders gate guidance text for prompts/chains.
/**
 * Gate Guidance Renderer - User-Facing Guidance Generation
 *
 * Single responsibility: Generate and format gate guidance for users.
 */

import { REMINDER_CHARS_PER_TOKEN } from '../constants.js';
import { filterFrameworkGuidance, hasFrameworkSpecificContent } from './FrameworkGuidanceFilter.js';
import { deriveGateTier } from '../core/gate-tier.js';

import type { Logger } from '#infra/logging/index.js';
import type { GateContext } from '../core/gate-definitions.js';
import type { GateDefinitionProvider } from '../core/gate-loader.js';
import type { TemporaryGateRegistry } from '../core/temporary-gate-registry.js';
import type { GateActivationContext, LightweightGateDefinition } from '../types.js';

import { DEFAULT_GATES_CONFIG } from '#shared/types/core-config.js';

/**
 * The slice of `gates` config this renderer reads. Narrower than `ResolvedGateSettings` on purpose:
 * `ConfigManager.getGatesConfig()` satisfies it structurally, and a test can supply a literal.
 */
export interface GateGuidanceConfig {
  harnessCovers?: readonly string[];
  reminderTokenBudget?: number;
}

/**
 * Closing attestation line shared by every gate-guidance render path — the canonical renderer
 * here and the fallback in chain-operator-executor.ts. Exported so the fallback imports this
 * literal instead of carrying its own copy that can drift (row 0.9, gate-checks-and-reminders).
 */
export const GATE_ATTESTATION_LINE =
  "Attest reminders in the verdict's `reminders` field; checks are recorded by the engine.";

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
    const checkLines: string[] = [];
    const reminders: ReminderEntry[] = [];
    const explicitSet = new Set(context.explicitGateIds ?? []);
    let suppressedCount = 0;

    for (const [inputOrder, gateId] of gateIds.entries()) {
      try {
        const gate = await this.loadGateDefinition(gateId);
        if (!gate) {
          this.logger.debug('[GATE GUIDANCE RENDERER] Failed to load gate:', gateId);
          continue;
        }

        const isExplicit = explicitSet.has(gateId);
        const inline = this.isInlineGate(gateId, gate) || isExplicit;

        if (!inline && !this.isGateActive(gate, context, isExplicit)) {
          this.logger.debug('[GATE GUIDANCE RENDERER] Skipped gate (not applicable):', gateId);
          continue;
        }

        // A check has a runtime evaluator, so the engine records its verdict from the run.
        // Emitting its guidance would ask the agent to self-attest something already measured,
        // so a check contributes exactly one line naming what it runs — and is never suppressed
        // and never budgeted.
        if (deriveGateTier(gate) === 'check') {
          checkLines.push(this.formatCheckLine(gate));
          this.logger.debug('[GATE GUIDANCE RENDERER] Added check line for gate:', gateId);
          continue;
        }

        // harnessCovers suppresses reminders only, and it outranks the prompt author: a gate
        // named explicitly in the command is still dropped when the operator's config says the
        // harness already covers its subject (ruling B2). A reminder with no `subject` names no
        // coverable topic, so it is never suppressed.
        if (gate.subject && harnessCovers.includes(gate.subject)) {
          suppressedCount += 1;
          this.logger.debug(
            '[GATE GUIDANCE RENDERER] Suppressed reminder covered by harness:',
            gateId,
            gate.subject
          );
          continue;
        }

        const rendered = this.formatGateGuidance(gate, context);
        reminders.push({
          gate,
          explicit: isExplicit,
          rendered,
          tokens: Math.ceil(rendered.length / REMINDER_CHARS_PER_TOKEN),
          inputOrder,
        });
        this.logger.debug('[GATE GUIDANCE RENDERER] Added guidance for gate:', gateId);
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

    sections.push('\n\n' + GATE_ATTESTATION_LINE);

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
   * One line per check naming the command or tool that produces its verdict — never its guidance.
   */
  private formatCheckLine(gate: LightweightGateDefinition): string {
    const criterion = (gate.pass_criteria ?? []).find(
      (entry) => entry.type === 'shell_verify' || entry.type === 'script_tool'
    );

    if (criterion?.type === 'shell_verify' && criterion.shell_command?.length) {
      return `- **${gate.name}** — check: runs \`${criterion.shell_command.join(' ')}\``;
    }
    if (criterion?.type === 'script_tool' && criterion.script_tool_id) {
      return `- **${gate.name}** — check: runs tool \`${criterion.script_tool_id}\``;
    }
    // A check whose criterion names neither a command nor a tool id cannot run; still list it,
    // so an operator sees the gate rather than silently losing it.
    return `- **${gate.name}** — check`;
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
   * Get available gate IDs (for testing and diagnostics)
   */
  async getAvailableGates(): Promise<string[]> {
    return this.gateLoader.listAvailableGates();
  }

  /**
   * Get detailed gate definitions for listing/discovery
   */
  async getAvailableGateDefinitions(): Promise<LightweightGateDefinition[]> {
    return this.gateLoader.listAvailableGateDefinitions();
  }

  /**
   * Clear cache (for hot-reloading support)
   */
  clearCache(): void {
    this.gateLoader.clearCache();
    this.logger.debug('[GATE GUIDANCE RENDERER] Delegated cache clear to GateLoader');
  }

  /**
   * Get renderer statistics (for monitoring)
   */
  getStatistics(): { cachedGates: number; gatesDirectory: string } {
    const stats = this.gateLoader.getStatistics();
    return {
      cachedGates: stats.cachedGates,
      gatesDirectory: 'loader-managed',
    };
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

// @lifecycle canonical - Renders gate guidance text for prompts/chains.
/**
 * Gate Guidance Renderer - User-Facing Guidance Generation
 *
 * Single responsibility: Generate and format gate guidance for users.
 */

import { filterFrameworkGuidance, hasFrameworkSpecificContent } from './FrameworkGuidanceFilter.js';

import type { Logger } from '../../logging/index.js';
import type { GateContext } from '../core/gate-definitions.js';
import type { GateDefinitionProvider } from '../core/gate-loader.js';
import type { TemporaryGateRegistry } from '../core/temporary-gate-registry.js';
import type { GateActivationContext, LightweightGateDefinition } from '../types.js';

export interface GateGuidanceRendererOptions {
  gateLoader: GateDefinitionProvider;
  temporaryGateRegistry?: TemporaryGateRegistry;
  frameworkIdentifierProvider?: () => readonly string[] | undefined;
}

/**
 * Gate guidance renderer with framework-specific filtering and temporary gate support
 */
export class GateGuidanceRenderer {
  private readonly logger: Logger;
  private readonly gateLoader: GateDefinitionProvider;
  private readonly temporaryGateRegistry: TemporaryGateRegistry | undefined;
  private readonly frameworkIdentifierProvider: (() => readonly string[] | undefined) | undefined;

  constructor(logger: Logger, options: GateGuidanceRendererOptions) {
    if (!options?.gateLoader) {
      throw new Error('GateGuidanceRenderer requires a gate loader/provider instance');
    }

    this.logger = logger;
    this.gateLoader = options.gateLoader;
    this.temporaryGateRegistry = options.temporaryGateRegistry;
    this.frameworkIdentifierProvider = options.frameworkIdentifierProvider;

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

    const inlineGuidance: string[] = [];
    const frameworkGuidance: string[] = [];
    const explicitSet = new Set(context.explicitGateIds ?? []);

    for (const gateId of gateIds) {
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

        const formatted = this.formatGateGuidance(gate, context);
        if (inline) {
          inlineGuidance.push(formatted);
        } else {
          frameworkGuidance.push(formatted);
        }
        this.logger.debug('[GATE GUIDANCE RENDERER] Added guidance for gate:', gateId);
      } catch (error) {
        this.logger.warn('[GATE GUIDANCE RENDERER] Failed to load gate:', gateId, error);
      }
    }

    if (inlineGuidance.length === 0 && frameworkGuidance.length === 0) {
      this.logger.debug(
        '[GATE GUIDANCE RENDERER] No applicable gates found, returning empty guidance'
      );
      return '';
    }

    const sections: string[] = ['\n\n---\n\n## Inline Gates'];

    // Add inline guidance first (task-specific)
    if (inlineGuidance.length > 0) {
      sections.push('\n');
      sections.push([...new Set(inlineGuidance)].join('\n\n'));
    }

    // Add framework guidance second (universal standards)
    if (frameworkGuidance.length > 0) {
      sections.push('\n\n');
      sections.push(frameworkGuidance.join('\n\n'));
    }

    // Add post-execution review LAST (final reminder)
    sections.push('\n\n**Post-Execution Review Guidelines:**');
    sections.push(
      'Review your output against these quality standards before finalizing your response.'
    );

    sections.push('\n\n---');

    const supplementalGuidance = sections.join('');

    this.logger.debug('[GATE GUIDANCE RENDERER] Generated supplemental guidance:', {
      inlineGateCount: inlineGuidance.length,
      frameworkGateCount: frameworkGuidance.length,
      guidanceLength: supplementalGuidance.length,
    });

    return supplementalGuidance;
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
   * based on framework context alone. This ensures framework methodology guidance
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
    return this.gateLoader.isGateActive(gate, activationContext);
  }

  /**
   * Format gate guidance for display with framework-specific filtering
   */
  private formatGateGuidance(gate: LightweightGateDefinition, context: GateContext): string {
    let guidance = gate.guidance ?? '';
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

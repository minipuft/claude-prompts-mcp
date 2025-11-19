// @lifecycle canonical - Renders gate guidance text for prompts/chains.
/**
 * Gate Guidance Renderer - User-Facing Guidance Generation
 *
 * Single responsibility: Generate and format gate guidance for users.
 * Clean dependencies: Only imports what it needs for guidance rendering.
 */

import type { Logger } from '../../logging/index.js';
import type { GateContext } from '../core/gate-definitions.js';
import type { GateLoader } from '../core/gate-loader.js';
import type { LightweightGateDefinition } from '../types.js';
import { filterFrameworkGuidance, hasFrameworkSpecificContent } from './FrameworkGuidanceFilter.js';
import type { TemporaryGateRegistry } from '../core/temporary-gate-registry.js';

export interface GateGuidanceRendererOptions {
  gateLoader: GateLoader;
  temporaryGateRegistry?: TemporaryGateRegistry;
  frameworkIdentifierProvider?: () => readonly string[] | undefined;
}

/**
 * Gate guidance renderer with framework-specific filtering and temporary gate support
 */
export class GateGuidanceRenderer {
  private readonly logger: Logger;
  private readonly gateLoader: GateLoader;
  private readonly temporaryGateRegistry?: TemporaryGateRegistry;
  private readonly frameworkIdentifierProvider?: () => readonly string[] | undefined;

  constructor(logger: Logger, options: GateGuidanceRendererOptions) {
    if (!options || !options.gateLoader) {
      throw new Error('GateGuidanceRenderer requires a GateLoader instance');
    }

    this.logger = logger;
    this.gateLoader = options.gateLoader;
    this.temporaryGateRegistry = options.temporaryGateRegistry;
    this.frameworkIdentifierProvider = options.frameworkIdentifierProvider;

    if (this.temporaryGateRegistry) {
      this.logger.debug('[GATE GUIDANCE RENDERER] Temporary gate registry enabled');
    }
    this.logger.debug('[GATE GUIDANCE RENDERER] Initialized with shared GateLoader cache');
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

    for (const gateId of gateIds) {
      try {
        const gate = await this.loadGateDefinition(gateId);
        if (!gate) {
          this.logger.debug('[GATE GUIDANCE RENDERER] Failed to load gate:', gateId);
          continue;
        }

        const inline = this.isInlineGate(gateId, gate);

        if (!inline && !this.isGateActive(gate, context)) {
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
      this.logger.debug('[GATE GUIDANCE RENDERER] No applicable gates found, returning empty guidance');
      return '';
    }

    const sections: string[] = [
      '\n\n---\n\n## 🎯 Quality Enhancement Gates',
    ];

    // Add inline guidance first (task-specific)
    if (inlineGuidance.length > 0) {
      sections.push('\n\n### 🎯 **Inline Quality Criteria** (PRIMARY VALIDATION)\n');
      sections.push(inlineGuidance.join('\n\n'));
    }

    // Add framework guidance second (universal standards)
    if (frameworkGuidance.length > 0) {
      sections.push('\n\n');
      sections.push(frameworkGuidance.join('\n\n'));
    }

    // Add post-execution review LAST (final reminder)
    sections.push('\n\n**Post-Execution Review Guidelines:**');
    sections.push('Review your output against these quality standards before finalizing your response.');

    sections.push('\n\n---');

    const supplementalGuidance = sections.join('');

    this.logger.debug('[GATE GUIDANCE RENDERER] Generated supplemental guidance:', {
      inlineGateCount: inlineGuidance.length,
      frameworkGateCount: frameworkGuidance.length,
      guidanceLength: supplementalGuidance.length
    });

    return supplementalGuidance;
  }

  private isInlineGate(gateId: string, gate: LightweightGateDefinition): boolean {
    if (gateId.startsWith('inline_gate_')) {
      return true;
    }

    const normalizedName = gate.name?.toLowerCase() ?? '';
    return normalizedName.includes('inline quality') || normalizedName.includes('inline gate');
  }

  /**
   * Load gate definition via the shared gate loader (with temporary registry fallback)
   */
  private async loadGateDefinition(gateId: string): Promise<LightweightGateDefinition | null> {
    const gate = await this.gateLoader.loadGate(gateId);
    if (gate) {
      return gate;
    }

    if (gateId.startsWith('temp_') && this.temporaryGateRegistry) {
      this.logger.debug('[GATE GUIDANCE RENDERER] Attempting to load temporary gate:', gateId);
      const tempGate = this.temporaryGateRegistry.getTemporaryGate(gateId);

      if (tempGate) {
        const lightweight = this.temporaryGateRegistry.convertToLightweightGate(tempGate);
        this.logger.info('[GATE GUIDANCE RENDERER] ✅ Loaded temporary gate:', {
          gateId,
          name: tempGate.name,
          guidanceLength: tempGate.guidance.length
        });

        return lightweight;
      }

      this.logger.warn('[GATE GUIDANCE RENDERER] ⚠️ Temporary gate not found in registry:', gateId);
    }

    this.logger.warn('[GATE GUIDANCE RENDERER] Gate definition not found via loader:', gateId);
    return null;
  }

  /**
   * Check if gate should be activated for current context
   *
   * Framework gates (gate_type: "framework") bypass category checks and activate
   * based on framework context alone. This ensures framework methodology guidance
   * applies universally across all categories.
   */
  private isGateActive(gate: LightweightGateDefinition, context: GateContext): boolean {
    return this.gateLoader.isGateActive(gate, {
      promptCategory: context.category,
      framework: context.framework,
      explicitRequest: false,
    });
  }

  /**
   * Format gate guidance for display with framework-specific filtering
   */
  private formatGateGuidance(gate: LightweightGateDefinition, context: GateContext): string {
    let guidance = gate.guidance ?? '';
    const frameworkNames = this.frameworkIdentifierProvider?.();

    if (context.framework && hasFrameworkSpecificContent(guidance, frameworkNames)) {
      guidance = filterFrameworkGuidance(guidance, context.framework, frameworkNames);
      this.logger.debug('[GATE GUIDANCE RENDERER] Applied framework filtering for:', context.framework);
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
      gatesDirectory: 'loader-managed'
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

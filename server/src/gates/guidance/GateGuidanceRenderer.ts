/**
 * Gate Guidance Renderer - User-Facing Guidance Generation
 *
 * Single responsibility: Generate and format gate guidance for users.
 * Clean dependencies: Only imports what it needs for guidance rendering.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { Logger } from '../../logging/index.js';
import { GateDefinition, GateContext } from '../core/gate-definitions.js';
import { filterFrameworkGuidance, hasFrameworkSpecificContent } from './FrameworkGuidanceFilter.js';

/**
 * Gate guidance renderer with framework-specific filtering
 */
export class GateGuidanceRenderer {
  private gateCache = new Map<string, GateDefinition>();
  private gatesDirectory: string;
  private logger: Logger;

  constructor(logger: Logger, gatesDirectory?: string) {
    this.logger = logger;
    // Use same directory resolution pattern as existing system
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    this.gatesDirectory = gatesDirectory || path.join(__dirname, '../../gates/definitions');

    this.logger.debug('[GATE GUIDANCE RENDERER] Initialized with directory:', this.gatesDirectory);
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
      gatesDirectory: this.gatesDirectory
    });

    if (gateIds.length === 0) {
      this.logger.debug('[GATE GUIDANCE RENDERER] No gates provided, returning empty guidance');
      return '';
    }

    const guidanceTexts: string[] = [];

    for (const gateId of gateIds) {
      try {
        const gate = await this.loadGateDefinition(gateId);
        if (gate) {
          if (this.shouldActivateGate(gate, context)) {
            guidanceTexts.push(this.formatGateGuidance(gate, context));
            this.logger.debug('[GATE GUIDANCE RENDERER] Added guidance for gate:', gateId);
          } else {
            this.logger.debug('[GATE GUIDANCE RENDERER] Skipped gate (not applicable):', gateId);
          }
        } else {
          this.logger.debug('[GATE GUIDANCE RENDERER] Failed to load gate:', gateId);
        }
      } catch (error) {
        this.logger.warn('[GATE GUIDANCE RENDERER] Failed to load gate:', gateId, error);
      }
    }

    if (guidanceTexts.length === 0) {
      this.logger.debug('[GATE GUIDANCE RENDERER] No applicable gates found, returning empty guidance');
      return '';
    }

    // Format as supplemental guidance section (clean formatting)
    const supplementalGuidance = `

---

## 🎯 Quality Enhancement Gates

*These are supplemental quality guidelines to enhance your ${context.framework || 'framework'} methodology:*

${guidanceTexts.join('\n\n')}

---`;

    this.logger.debug('[GATE GUIDANCE RENDERER] Generated supplemental guidance:', {
      gateCount: guidanceTexts.length,
      guidanceLength: supplementalGuidance.length
    });

    return supplementalGuidance;
  }

  /**
   * Load gate definition from file system
   */
  private async loadGateDefinition(gateId: string): Promise<GateDefinition | null> {
    // Check cache first (performance optimization)
    if (this.gateCache.has(gateId)) {
      return this.gateCache.get(gateId)!;
    }

    try {
      const gateFile = path.join(this.gatesDirectory, `${gateId}.json`);
      const fileContent = await fs.readFile(gateFile, 'utf-8');
      const gateData = JSON.parse(fileContent);

      // Extract essential fields for guidance rendering
      const gate: GateDefinition = {
        id: gateData.id,
        name: gateData.name,
        guidance: gateData.guidance || '',
        activation: gateData.activation || {}
      };

      // Cache for reuse (performance optimization)
      this.gateCache.set(gateId, gate);
      this.logger.debug('[GATE GUIDANCE RENDERER] Loaded and cached gate definition:', gateId);

      return gate;
    } catch (error) {
      this.logger.error('[GATE GUIDANCE RENDERER] Failed to load gate definition:', gateId, error);
      return null;
    }
  }

  /**
   * Check if gate should be activated for current context
   */
  private shouldActivateGate(gate: GateDefinition, context: GateContext): boolean {
    const activation = gate.activation;

    this.logger.debug('[GATE GUIDANCE RENDERER] shouldActivateGate called:', {
      gateId: gate.id,
      contextFramework: context.framework,
      activationFrameworkContext: activation.framework_context,
      contextCategory: context.category,
      activationPromptCategories: activation.prompt_categories
    });

    // Check framework context match
    if (context.framework && activation.framework_context) {
      if (!activation.framework_context.includes(context.framework)) {
        this.logger.debug('[GATE GUIDANCE RENDERER] Gate not activated - framework mismatch:', {
          gateId: gate.id,
          expectedFrameworks: activation.framework_context,
          actualFramework: context.framework
        });
        return false;
      }
    }

    // Check category context match
    if (context.category && activation.prompt_categories) {
      if (!activation.prompt_categories.includes(context.category)) {
        this.logger.debug('[GATE GUIDANCE RENDERER] Gate not activated - category mismatch:', {
          gateId: gate.id,
          expectedCategories: activation.prompt_categories,
          actualCategory: context.category
        });
        return false;
      }
    }

    // If no specific criteria or all criteria match, activate
    this.logger.debug('[GATE GUIDANCE RENDERER] Gate activated:', gate.id);
    return true;
  }

  /**
   * Format gate guidance for display with framework-specific filtering
   */
  private formatGateGuidance(gate: GateDefinition, context: GateContext): string {
    let guidance = gate.guidance;

    // Apply framework filtering if framework is specified and guidance has framework content
    if (context.framework && hasFrameworkSpecificContent(guidance)) {
      guidance = filterFrameworkGuidance(guidance, context.framework);
      this.logger.debug('[GATE GUIDANCE RENDERER] Applied framework filtering for:', context.framework);
    }

    return `### ${gate.name}\n${guidance}`;
  }

  /**
   * Get available gate IDs (for testing and diagnostics)
   */
  async getAvailableGates(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.gatesDirectory);
      const gateIds = files
        .filter(file => file.endsWith('.json'))
        .map(file => file.replace('.json', ''));

      this.logger.debug('[GATE GUIDANCE RENDERER] Available gates:', gateIds);
      return gateIds;
    } catch (error) {
      this.logger.error('[GATE GUIDANCE RENDERER] Failed to list gate definitions:', error);
      return [];
    }
  }

  /**
   * Clear cache (for hot-reloading support)
   */
  clearCache(): void {
    this.gateCache.clear();
    this.logger.debug('[GATE GUIDANCE RENDERER] Cache cleared for hot-reloading');
  }

  /**
   * Get renderer statistics (for monitoring)
   */
  getStatistics(): { cachedGates: number; gatesDirectory: string } {
    return {
      cachedGates: this.gateCache.size,
      gatesDirectory: this.gatesDirectory
    };
  }
}

/**
 * Factory function for creating gate guidance renderer
 */
export function createGateGuidanceRenderer(logger: Logger, gatesDirectory?: string): GateGuidanceRenderer {
  return new GateGuidanceRenderer(logger, gatesDirectory);
}
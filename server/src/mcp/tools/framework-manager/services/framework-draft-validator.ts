// @lifecycle canonical - Framework validation operations: scoring, error formatting, success formatting.

import type { ToolResponse } from '../../../../shared/types/index.js';
import type { FrameworkCreationData, FrameworkDraftValidationResult } from '../core/types.js';

export class FrameworkDraftValidator {
  /**
   * Validate framework with strict requirements.
   *
   * Required fields (80% threshold):
   * - system_prompt_guidance (core LLM guidance)
   * - phases (framework structure)
   * - methodology_gates (quality validation)
   *
   * Returns structured errors for focused user guidance.
   */
  validate(data: FrameworkCreationData): FrameworkDraftValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required fields one at a time for focused feedback
    const hasPhases = Array.isArray(data.phases) && data.phases.length > 0;
    const hasGates = Array.isArray(data.methodology_gates) && data.methodology_gates.length > 0;

    if (!data.system_prompt_guidance?.trim()) {
      errors.push('system_prompt_guidance is required - defines core LLM guidance');
    } else if (!hasPhases) {
      errors.push('phases is required - defines framework structure');
    } else if (!hasGates) {
      errors.push('methodology_gates is required - enables quality validation');
    }

    // Calculate score
    let score = 0;
    if (data.system_prompt_guidance?.trim()) score += 30;
    if (hasPhases) score += 30;
    if (hasGates) score += 20;
    if (data.methodology_elements !== undefined) score += 10;
    if (data.template_suggestions !== undefined && data.template_suggestions.length > 0) {
      score += 5;
    }
    if (data.description?.trim()) score += 5;

    // RECOMMENDED fields - only warn if passed required checks
    if (errors.length === 0) {
      if (data.methodology_elements === undefined) {
        warnings.push('Add methodology_elements for structured prompt guidance');
      }
      if (data.template_suggestions === undefined || data.template_suggestions.length === 0) {
        warnings.push('Add template_suggestions for system/user prompt hints');
      }
      if (!data.description?.trim()) {
        warnings.push('Add description for framework overview');
      }
    }

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
   * Shows one focused error with helpful example.
   */
  createErrorResponse(id: string, validation: FrameworkDraftValidationResult): ToolResponse {
    let message = `❌ Framework '${id}' validation failed (${validation.score}% complete)\n\n`;
    message += `**Issue:** ${validation.errors[0]}\n\n`;

    // Show contextual example based on what's missing
    if (validation.errors[0]?.includes('phases')) {
      message += `**Example phases:**\n\`\`\`json\n${JSON.stringify(
        [
          { id: 'analyze', name: 'Analyze', description: 'Understand the problem' },
          { id: 'design', name: 'Design', description: 'Plan the solution' },
          { id: 'implement', name: 'Implement', description: 'Build the solution' },
        ],
        null,
        2
      )}\n\`\`\``;
    } else if (validation.errors[0]?.includes('methodology_gates')) {
      message += `**Example methodology_gates:**\n\`\`\`json\n${JSON.stringify(
        [
          {
            id: 'analysis-complete',
            name: 'Analysis Gate',
            description: 'Validates analysis phase',
            frameworkArea: 'analysis',
            priority: 'high',
            validationCriteria: ['Problem clearly defined', 'Constraints identified'],
          },
        ],
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
    let message = `✅ Framework '${id}' created (${validation.score}% - ${validation.level})\n\n`;
    message += `**Files:**\n${paths.map((p) => `  • ${p}`).join('\n')}\n\n`;

    if (validation.warnings.length > 0) {
      message += `**Recommendations:**\n${validation.warnings
        .slice(0, 3)
        .map((w) => `  • ${w}`)
        .join('\n')}`;
    }

    return message;
  }
}

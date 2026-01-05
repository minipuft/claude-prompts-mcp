// @lifecycle canonical - Data-driven compliance validation utilities.
/**
 * Compliance Validator
 *
 * Generic utility for validating methodology compliance using data-driven
 * phase definitions from YAML/JSON. Extracts validation logic from
 * TypeScript methodology guides to work with any methodology definition.
 */

import type { MethodologyValidation, TemplateEnhancement } from '../types/methodology-types.js';

/**
 * Quality indicator definition from methodology YAML
 */
export interface QualityIndicator {
  keywords: string[];
  patterns: string[];
}

/**
 * Phase quality indicators from methodology definition
 */
export interface PhaseQualityIndicators {
  [phaseName: string]: QualityIndicator;
}

/**
 * Phase detection result
 */
export interface PhaseDetection {
  present: boolean;
  quality: number;
}

/**
 * Compliance validation options
 */
export interface ComplianceValidatorOptions {
  /** Minimum compliance score to be considered compliant (default: 0.6) */
  complianceThreshold?: number;
  /** Weight for phase presence in score (default: 0.7) */
  presenceWeight?: number;
  /** Weight for quality assessment in score (default: 0.3) */
  qualityWeight?: number;
}

const DEFAULT_OPTIONS: Required<ComplianceValidatorOptions> = {
  complianceThreshold: 0.6,
  presenceWeight: 0.7,
  qualityWeight: 0.3,
};

/**
 * Assesses quality of a single phase based on quality indicators
 * @param text - Combined text to analyze
 * @param indicators - Quality indicators for the phase
 * @returns Quality score between 0 and 1
 */
export function assessPhaseQuality(text: string, indicators: QualityIndicator): number {
  if (!indicators.patterns || indicators.patterns.length === 0) {
    return 0;
  }

  const matchedPatterns = indicators.patterns.filter((pattern) => {
    try {
      const regex = new RegExp(pattern, 'i');
      return regex.test(text);
    } catch {
      return false;
    }
  });

  return matchedPatterns.length / indicators.patterns.length;
}

/**
 * Detects presence of a phase and assesses its quality
 * @param text - Combined text to analyze
 * @param indicators - Quality indicators for the phase
 * @returns Phase detection result with presence and quality
 */
export function detectPhase(text: string, indicators: QualityIndicator): PhaseDetection {
  const textLower = text.toLowerCase();

  // Check keyword presence
  const hasKeywords =
    indicators.keywords?.some((keyword) => textLower.includes(keyword.toLowerCase())) ?? false;

  // If keywords present, assess quality using patterns
  const quality = hasKeywords ? assessPhaseQuality(text, indicators) : 0;

  return {
    present: hasKeywords,
    quality,
  };
}

/**
 * Validates methodology compliance for a given text
 * @param text - Combined text to validate
 * @param qualityIndicators - Phase quality indicators from methodology definition
 * @param options - Validation options
 * @returns Methodology validation result
 */
export function validateCompliance(
  text: string,
  qualityIndicators: PhaseQualityIndicators,
  options: ComplianceValidatorOptions = {}
): MethodologyValidation {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const phaseNames = Object.keys(qualityIndicators);

  // Detect all phases
  const phaseDetections: Record<string, PhaseDetection> = {};
  for (const phaseName of phaseNames) {
    const indicator = qualityIndicators[phaseName];
    if (!indicator) {
      continue;
    }
    phaseDetections[phaseName] = detectPhase(text, indicator);
  }

  // Calculate compliance score
  const presentPhases = Object.values(phaseDetections).filter((p) => p.present).length;
  const qualitySum = Object.values(phaseDetections).reduce(
    (sum, p) => sum + (p.present ? p.quality : 0),
    0
  );

  const totalPhases = phaseNames.length;
  const complianceScore =
    totalPhases > 0
      ? (presentPhases * opts.presenceWeight + qualitySum * opts.qualityWeight) / totalPhases
      : 0;

  // Build strengths and improvement areas
  const strengths: string[] = [];
  const improvementAreas: string[] = [];
  const specificSuggestions: TemplateEnhancement[] = [];

  for (const [phaseName, detection] of Object.entries(phaseDetections)) {
    const capitalizedPhase = phaseName.charAt(0).toUpperCase() + phaseName.slice(1);

    if (detection.present) {
      if (detection.quality > 0.7) {
        strengths.push(
          `Strong ${capitalizedPhase.toLowerCase()} coverage with comprehensive depth`
        );
      } else if (detection.quality > 0.4) {
        strengths.push(
          `${capitalizedPhase} awareness present - could be enhanced with more detail`
        );
      } else {
        improvementAreas.push(
          `${capitalizedPhase} present but lacks depth - strengthen systematic approach`
        );
      }
    } else {
      improvementAreas.push(`Missing ${capitalizedPhase.toLowerCase()} elements`);
      specificSuggestions.push({
        section: 'system',
        type: 'addition',
        description: `Add ${capitalizedPhase.toLowerCase()} framework`,
        content: `Include comprehensive ${capitalizedPhase.toLowerCase()} considerations in your approach.`,
        methodologyJustification: `Methodology requires ${capitalizedPhase.toLowerCase()} phase coverage`,
        impact: 'high',
      });
    }
  }

  return {
    compliant: complianceScore > opts.complianceThreshold,
    complianceScore: complianceScore,
    strengths,
    improvementAreas,
    specificSuggestions,
    methodologyGaps: improvementAreas.filter((area) => {
      const areaToken = area.split(' ')[1];
      if (!areaToken) {
        return !strengths.some((s) => s.toLowerCase().includes(area.toLowerCase()));
      }
      const normalizedArea = areaToken.toLowerCase();
      return !strengths.some((s) => s.toLowerCase().includes(normalizedArea));
    }),
  };
}

/**
 * Gets combined text from a prompt-like object
 * @param prompt - Object with optional text fields
 * @returns Combined text from all fields
 */
export function getCombinedText(prompt: {
  systemMessage?: string;
  userMessageTemplate?: string;
  description?: string;
}): string {
  return [prompt.systemMessage || '', prompt.userMessageTemplate || '', prompt.description || '']
    .filter((text) => text.trim())
    .join(' ');
}

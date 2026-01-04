/**
 * Compliance Validator
 *
 * Generic utility for validating methodology compliance using data-driven
 * phase definitions from YAML/JSON. Extracts validation logic from
 * TypeScript methodology guides to work with any methodology definition.
 */
import type { MethodologyValidation } from '../types/methodology-types.js';
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
/**
 * Assesses quality of a single phase based on quality indicators
 * @param text - Combined text to analyze
 * @param indicators - Quality indicators for the phase
 * @returns Quality score between 0 and 1
 */
export declare function assessPhaseQuality(text: string, indicators: QualityIndicator): number;
/**
 * Detects presence of a phase and assesses its quality
 * @param text - Combined text to analyze
 * @param indicators - Quality indicators for the phase
 * @returns Phase detection result with presence and quality
 */
export declare function detectPhase(text: string, indicators: QualityIndicator): PhaseDetection;
/**
 * Validates methodology compliance for a given text
 * @param text - Combined text to validate
 * @param qualityIndicators - Phase quality indicators from methodology definition
 * @param options - Validation options
 * @returns Methodology validation result
 */
export declare function validateCompliance(text: string, qualityIndicators: PhaseQualityIndicators, options?: ComplianceValidatorOptions): MethodologyValidation;
/**
 * Gets combined text from a prompt-like object
 * @param prompt - Object with optional text fields
 * @returns Combined text from all fields
 */
export declare function getCombinedText(prompt: {
    systemMessage?: string;
    userMessageTemplate?: string;
    description?: string;
}): string;

/**
 * Framework Guidance Filter - Pure Function Implementation
 *
 * Extracts framework-specific guidance from multi-framework guidance text.
 * This is a pure function with no dependencies for maximum reusability.
 */
/**
 * Filter guidance text to show only the specified framework's guidance
 */
export declare function filterFrameworkGuidance(guidance: string, activeFramework: string, frameworkNames?: readonly string[]): string;
/**
 * Check if guidance text contains framework-specific content
 */
export declare function hasFrameworkSpecificContent(guidance: string, frameworkNames?: readonly string[]): boolean;
/**
 * Get list of frameworks mentioned in guidance text
 */
export declare function getFrameworksInGuidance(guidance: string, frameworkNames?: readonly string[]): string[];

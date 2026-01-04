// @lifecycle canonical - Core framework and methodology type definitions.
/**
 * Methodology Guide Type Definitions
 *
 * Contains all types related to methodology guides, framework definitions,
 * and methodology-specific interfaces. This consolidates types from multiple
 * sources to eliminate duplication.
 */
/**
 * Default framework types (canonical built-in implementations).
 *
 * IMPORTANT: This constant is for DOCUMENTATION and type guards only.
 * For runtime validation, use frameworkManager.getFramework(id) which
 * supports both built-in and custom frameworks from the registry.
 *
 * @see FrameworkManager.getFramework() for runtime validation
 */
export const BUILTIN_FRAMEWORK_TYPES = ['CAGEERF', 'ReACT', '5W1H', 'SCAMPER'];
/**
 * Type guard to check if a type is a built-in framework
 */
export function isBuiltinFramework(type) {
    return BUILTIN_FRAMEWORK_TYPES.includes(type);
}
/**
 * Base class for methodology guides
 * Provides common functionality for all methodology implementations
 */
export class BaseMethodologyGuide {
    /**
     * Helper method to extract combined text from prompt
     */
    getCombinedText(prompt) {
        return [prompt.systemMessage || '', prompt.userMessageTemplate || '', prompt.description || '']
            .filter((text) => text.trim())
            .join(' ');
    }
    /**
     * Helper method to create enhancement metadata
     */
    createEnhancementMetadata(confidence, reason) {
        return {
            methodology: this.methodology,
            confidence,
            applicabilityReason: reason,
            appliedAt: new Date(),
        };
    }
}
//# sourceMappingURL=methodology-types.js.map
// @lifecycle canonical - Data-driven template enhancement utilities.
/**
 * Template Enhancer
 *
 * Generic utility for applying methodology-driven template enhancements.
 * Works with template suggestions and methodology elements from YAML/JSON
 * definitions without requiring methodology-specific TypeScript code.
 */
/**
 * Converts methodology template suggestions to TemplateEnhancement format
 * @param suggestions - Template suggestions from methodology YAML
 * @returns Array of TemplateEnhancement objects
 */
export function convertTemplateSuggestions(suggestions) {
    return suggestions.map((suggestion) => ({
        section: suggestion.section,
        type: suggestion.type,
        description: suggestion.description,
        content: suggestion.content,
        methodologyJustification: suggestion.methodologyJustification,
        impact: suggestion.impact,
    }));
}
/**
 * Converts methodology gate definitions to QualityGate format
 * @param gates - Gate definitions from methodology YAML
 * @returns Array of QualityGate objects
 */
export function convertMethodologyGates(gates) {
    return gates.map((gate) => ({
        id: gate.id,
        name: gate.name,
        description: gate.description,
        methodologyArea: gate.methodologyArea,
        validationCriteria: gate.validationCriteria,
        priority: gate.priority,
    }));
}
/**
 * Converts processing step definitions to ProcessingStep format
 * @param steps - Processing step definitions from methodology YAML
 * @returns Array of ProcessingStep objects
 */
export function convertProcessingSteps(steps) {
    return steps.map((step) => ({
        id: step.id,
        name: step.name,
        description: step.description,
        methodologyBasis: step.methodologyBasis,
        order: step.order,
        required: step.required,
    }));
}
/**
 * Creates a MethodologyEnhancement from a methodology definition
 * @param definition - Methodology definition from YAML/JSON
 * @param _context - Execution context (currently unused, for future extensions)
 * @param confidence - Confidence score for the enhancement (default: 0.9)
 * @returns MethodologyEnhancement object
 */
export function createMethodologyEnhancement(definition, _context = {}, confidence = 0.9) {
    const processingSteps = definition.phases?.processingSteps ?? [];
    const templateSuggestions = definition.templateSuggestions ?? [];
    const methodologyGates = definition.methodologyGates ?? [];
    return {
        systemPromptGuidance: definition.systemPromptGuidance,
        processingEnhancements: convertProcessingSteps(processingSteps),
        methodologyGates: convertMethodologyGates(methodologyGates),
        templateSuggestions: convertTemplateSuggestions(templateSuggestions),
        enhancementMetadata: {
            methodology: definition.type || definition.methodology,
            confidence,
            applicabilityReason: `${definition.type || definition.methodology} methodology provides systematic approach`,
            appliedAt: new Date(),
        },
    };
}
/**
 * Gets system prompt guidance from a methodology definition
 * @param definition - Methodology definition
 * @param _context - Execution context (for future template interpolation)
 * @returns System prompt guidance string
 */
export function getSystemPromptGuidance(definition, _context = {}) {
    return definition.systemPromptGuidance;
}
//# sourceMappingURL=template-enhancer.js.map
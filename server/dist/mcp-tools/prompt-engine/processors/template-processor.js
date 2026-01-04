/**
 * Template Processor - Handles template processing logic
 *
 * Extracted from ConsolidatedPromptEngine to provide focused
 * template processing capabilities with clear separation of concerns.
 */
import { processTemplate } from "../../../utils/jsonUtils.js";
import { createLogger } from "../../../logging/index.js";
const logger = createLogger({
    logFile: '/tmp/template-processor.log',
    transport: 'stdio',
    enableDebug: false,
    configuredLevel: 'info'
});
/**
 * TemplateProcessor handles all template-related processing
 *
 * This class provides:
 * - Template argument processing and validation
 * - Variable substitution and template rendering
 * - Template error handling and validation
 * - Integration with Nunjucks template engine
 */
export class TemplateProcessor {
    /**
     * Process template with provided arguments
     */
    processTemplate(convertedPrompt, promptArgs) {
        try {
            logger.debug('🎯 [Template] Processing template with arguments', {
                promptId: convertedPrompt.id,
                argsCount: Object.keys(promptArgs).length
            });
            const processedContent = processTemplate(convertedPrompt.userMessageTemplate, promptArgs);
            logger.debug('✅ [Template] Template processed successfully', {
                promptId: convertedPrompt.id,
                contentLength: processedContent.length
            });
            return processedContent;
        }
        catch (error) {
            logger.error('❌ [Template] Template processing failed', {
                promptId: convertedPrompt.id,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    /**
     * Validate template arguments against prompt requirements
     */
    validateTemplateArguments(convertedPrompt, promptArgs) {
        const missingArgs = [];
        const errors = [];
        try {
            // Check required arguments
            if (convertedPrompt.arguments) {
                for (const arg of convertedPrompt.arguments) {
                    if (arg.required && !promptArgs.hasOwnProperty(arg.name)) {
                        missingArgs.push(arg.name);
                    }
                }
            }
            // Validate argument types if specified
            if (convertedPrompt.arguments) {
                for (const arg of convertedPrompt.arguments) {
                    if (promptArgs.hasOwnProperty(arg.name)) {
                        const value = promptArgs[arg.name];
                        if (!this.validateArgumentType(value, arg.type || 'string')) {
                            errors.push(`Argument '${arg.name}' should be of type '${arg.type}'`);
                        }
                    }
                }
            }
            const isValid = missingArgs.length === 0 && errors.length === 0;
            logger.debug('🔍 [Template] Argument validation result', {
                promptId: convertedPrompt.id,
                isValid,
                missingArgs,
                errorsCount: errors.length
            });
            return { isValid, missingArgs, errors };
        }
        catch (error) {
            logger.error('❌ [Template] Argument validation failed', {
                promptId: convertedPrompt.id,
                error: error instanceof Error ? error.message : String(error)
            });
            return {
                isValid: false,
                missingArgs,
                errors: [...errors, `Validation error: ${error instanceof Error ? error.message : String(error)}`]
            };
        }
    }
    /**
     * Validate argument type
     */
    validateArgumentType(value, expectedType) {
        switch (expectedType.toLowerCase()) {
            case 'string':
                return typeof value === 'string';
            case 'number':
                return typeof value === 'number' && !isNaN(value);
            case 'boolean':
                return typeof value === 'boolean';
            case 'array':
                return Array.isArray(value);
            case 'object':
                return typeof value === 'object' && value !== null && !Array.isArray(value);
            default:
                // Unknown types are considered valid
                return true;
        }
    }
    /**
     * Extract template variables from content
     */
    extractTemplateVariables(content) {
        const variables = [];
        try {
            if (!content)
                return [];
            // Extract Nunjucks-style variables {{variable}}
            const matches = content.match(/\{\{\s*([^}]+)\s*\}\}/g);
            if (matches) {
                for (const match of matches) {
                    const variable = match.replace(/[\{\}\s]/g, '');
                    if (!variables.includes(variable)) {
                        variables.push(variable);
                    }
                }
            }
            logger.debug('🔍 [Template] Extracted template variables', {
                variablesCount: variables.length,
                variables
            });
            return variables;
        }
        catch (error) {
            logger.error('❌ [Template] Variable extraction failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }
}
//# sourceMappingURL=template-processor.js.map
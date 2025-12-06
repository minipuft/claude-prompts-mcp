/**
 * Template Processor - Handles template processing logic
 *
 * Extracted from PromptExecutionService to provide focused
 * template processing capabilities with clear separation of concerns.
 */
import { ConvertedPrompt } from "../../../types/index.js";
/**
 * TemplateProcessor handles all template-related processing
 *
 * This class provides:
 * - Template argument processing and validation
 * - Variable substitution and template rendering
 * - Template error handling and validation
 * - Integration with Nunjucks template engine
 */
export declare class TemplateProcessor {
    /**
     * Process template with provided arguments
     */
    processTemplate(convertedPrompt: ConvertedPrompt, promptArgs: Record<string, any>): string;
    /**
     * Validate template arguments against prompt requirements
     */
    validateTemplateArguments(convertedPrompt: ConvertedPrompt, promptArgs: Record<string, any>): {
        isValid: boolean;
        missingArgs: string[];
        errors: string[];
    };
    /**
     * Validate argument type
     */
    private validateArgumentType;
    /**
     * Extract template variables from content
     */
    extractTemplateVariables(content: string | undefined): string[];
}

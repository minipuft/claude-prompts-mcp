/**
 * Argument Parser - Handles argument parsing and validation
 *
 * Extracted from ConsolidatedPromptEngine to provide focused
 * argument parsing capabilities with clear separation of concerns.
 */
import { createLogger } from "../../../logging/index.js";
const logger = createLogger({
    logFile: "/tmp/argument-parser.log",
    transport: "stdio",
    enableDebug: false,
    configuredLevel: "info",
});
/**
 * ArgumentParser handles all argument-related parsing and validation
 */
export class ArgumentParser {
    // Simplified argument parser - no external dependencies
    /**
     * Parse command and extract arguments
     */
    parseCommand(command, options = {}) {
        try {
            logger.debug("🔍 [ArgumentParser] Parsing command", { command });
            const parts = command.trim().split(/\s+/);
            const promptId = parts[0] || "";
            // Extract JSON arguments if present
            let promptArgs = {};
            if (parts.length > 1) {
                const argsString = parts.slice(1).join(" ");
                try {
                    promptArgs = JSON.parse(argsString);
                }
                catch {
                    // If not JSON, treat as simple key-value pairs
                    promptArgs = { content: argsString };
                }
            }
            const result = {
                promptId,
                promptArgs,
                executionMode: options.executionMode || "auto",
                sessionId: options.sessionId,
                forceRestart: options.forceRestart || false,
            };
            logger.debug("✅ [ArgumentParser] Command parsed successfully", {
                promptId: result.promptId,
                argsCount: Object.keys(result.promptArgs).length,
                executionMode: result.executionMode,
            });
            return result;
        }
        catch (error) {
            logger.error("❌ [ArgumentParser] Command parsing failed", {
                command,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    /**
     * Validate arguments against requirements
     */
    validateArguments(promptArgs, requirements) {
        const errors = [];
        const warnings = [];
        try {
            for (const req of requirements) {
                if (req.required && !Object.prototype.hasOwnProperty.call(promptArgs, req.name)) {
                    errors.push(`Missing required argument: ${req.name}`);
                }
            }
            for (const req of requirements) {
                if (Object.prototype.hasOwnProperty.call(promptArgs, req.name)) {
                    const value = promptArgs[req.name];
                    if (!this.isValidType(value, req.type)) {
                        errors.push(`Argument '${req.name}' should be of type '${req.type}', got '${typeof value}'`);
                    }
                }
            }
            const expectedArgs = requirements.map((req) => req.name);
            for (const argName of Object.keys(promptArgs)) {
                if (!expectedArgs.includes(argName)) {
                    warnings.push(`Unexpected argument: ${argName}`);
                }
            }
            const isValid = errors.length === 0;
            logger.debug("🔍 [ArgumentParser] Argument validation result", {
                isValid,
                errorsCount: errors.length,
                warningsCount: warnings.length,
            });
            return { isValid, errors, warnings };
        }
        catch (error) {
            logger.error("❌ [ArgumentParser] Argument validation failed", {
                error: error instanceof Error ? error.message : String(error),
            });
            return {
                isValid: false,
                errors: [
                    `Validation error: ${error instanceof Error ? error.message : String(error)}`,
                ],
                warnings,
            };
        }
    }
    /**
     * Build execution context from parsed arguments
     */
    buildExecutionContext(promptId, promptArgs, options = {}) {
        try {
            logger.debug("🔧 [ArgumentParser] Building execution context", {
                promptId,
                argsCount: Object.keys(promptArgs).length,
            });
            const context = {
                promptId,
                promptArgs,
                executionMode: options.executionMode || "auto",
                sessionId: options.sessionId || `session_${Date.now()}`,
                forceRestart: options.forceRestart || false,
                enableGates: options.enableGates !== false,
                frameworkId: options.frameworkId,
                contextData: options.contextData ?? {},
            };
            logger.debug("✅ [ArgumentParser] Execution context built successfully", {
                promptId: context.promptId,
                executionMode: context.executionMode,
                enableGates: context.enableGates,
            });
            return context;
        }
        catch (error) {
            logger.error("❌ [ArgumentParser] Context building failed", {
                promptId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    /**
     * Check if value matches expected type
     */
    isValidType(value, expectedType) {
        switch (expectedType.toLowerCase()) {
            case "string":
                return typeof value === "string";
            case "number":
                return typeof value === "number" && !Number.isNaN(value);
            case "boolean":
                return typeof value === "boolean";
            case "array":
                return Array.isArray(value);
            case "object":
                return typeof value === "object" && value !== null && !Array.isArray(value);
            case "any":
                return true;
            default:
                return true;
        }
    }
    /**
     * Extract command options from arguments
     */
    extractOptions(args) {
        return {
            executionMode: args.execution_mode || args.executionMode || "auto",
            sessionId: args.session_id || args.sessionId,
            forceRestart: args.force_restart || args.forceRestart || false,
            enableGates: args.enable_gates !== false && args.enableGates !== false,
            frameworkId: args.framework_id || args.frameworkId,
        };
    }
}
//# sourceMappingURL=argument-parser.js.map
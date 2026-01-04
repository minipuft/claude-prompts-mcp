// @lifecycle canonical - Shared constants for MCP tools and prompts.
/**
 * Constants for MCP Tools
 *
 * Centralized constants to avoid duplication and improve maintainability.
 */
/**
 * Tool names (MCP-registered tools only)
 */
export const TOOL_NAMES = {
    PROMPT_ENGINE: 'prompt_engine',
    SYSTEM_CONTROL: 'system_control',
    RESOURCE_MANAGER: 'resource_manager',
};
/**
 * Action types for each tool
 */
export const ACTIONS = {
    RESOURCE_MANAGER: {
        CREATE: 'create',
        UPDATE: 'update',
        DELETE: 'delete',
        RELOAD: 'reload',
        LIST: 'list',
        INSPECT: 'inspect',
        ANALYZE_TYPE: 'analyze_type',
        ANALYZE_GATES: 'analyze_gates',
        GUIDE: 'guide',
        SWITCH: 'switch',
    },
    SYSTEM_CONTROL: {
        STATUS: 'status',
        FRAMEWORK: 'framework',
        ANALYTICS: 'analytics',
        CONFIG: 'config',
        MAINTENANCE: 'maintenance',
    },
};
/**
 * Operation types for system control
 */
export const SYSTEM_OPERATIONS = {
    STATUS: {
        OVERVIEW: 'overview',
        HEALTH: 'health',
        DIAGNOSTICS: 'diagnostics',
        FRAMEWORK_STATUS: 'framework_status',
    },
    FRAMEWORK: {
        SWITCH: 'switch',
        LIST: 'list',
        ENABLE: 'enable',
        DISABLE: 'disable',
    },
    ANALYTICS: {
        VIEW: 'view',
        RESET: 'reset',
        HISTORY: 'history',
    },
    CONFIG: {
        GET: 'get',
        SET: 'set',
        LIST: 'list',
        VALIDATE: 'validate',
        RESTORE: 'restore',
    },
    MAINTENANCE: {
        RESTART: 'restart',
    },
};
/**
 * Output formats
 */
export const OUTPUT_FORMATS = {
    COMPACT: 'compact',
    DETAILED: 'detailed',
    JSON: 'json',
    MARKDOWN: 'markdown',
};
/**
 * Detail levels for inspection
 */
export const DETAIL_LEVELS = {
    OVERVIEW: 'overview',
    STEPS: 'steps',
    STRUCTURE: 'structure',
    GATES: 'gates',
    FLOW: 'flow',
    ANALYSIS: 'analysis',
    RAW: 'raw',
    FULL: 'full',
};
/**
 * Filter operators
 */
export const FILTER_OPERATORS = {
    EQUALS: '=',
    GREATER_THAN: '>',
    LESS_THAN: '<',
    GREATER_EQUAL: '>=',
    LESS_EQUAL: '<=',
    CONTAINS: '~',
    REGEX: '/',
    AND: 'AND',
    OR: 'OR',
    NOT: 'NOT',
};
/**
 * Validation patterns
 */
export const VALIDATION_PATTERNS = {
    PROMPT_ID: /^[a-zA-Z0-9_-]+$/,
    SESSION_ID: /^[a-zA-Z0-9_-]+$/,
    ARGUMENT_NAME: /^[a-zA-Z_][a-zA-Z0-9_]*$/,
    EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    URL: /^https?:\/\/.+/,
};
/**
 * Error codes
 */
export const ERROR_CODES = {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    CONFIG_ERROR: 'CONFIG_ERROR',
    FRAMEWORK_ERROR: 'FRAMEWORK_ERROR',
    EXECUTION_ERROR: 'EXECUTION_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    TIMEOUT: 'TIMEOUT',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
};
/**
 * Default limits and constraints
 */
export const LIMITS = {
    MAX_NAME_LENGTH: 100,
    MIN_NAME_LENGTH: 1,
    MAX_DESCRIPTION_LENGTH: 500,
    MIN_DESCRIPTION_LENGTH: 10,
    MAX_STEP_NAME_LENGTH: 50,
    MAX_FILTER_RESULTS: 1000,
    DEFAULT_PAGE_SIZE: 20,
    MAX_PAGE_SIZE: 100,
    CACHE_TTL: 300000, // 5 minutes
};
/**
 * Framework types
 */
export const FRAMEWORKS = {
    CAGEERF: 'CAGEERF',
    REACT: 'ReACT',
    FIVE_W_ONE_H: '5W1H',
    SCAMPER: 'SCAMPER',
};
/**
 * Category types
 */
export const CATEGORIES = {
    ANALYSIS: 'analysis',
    DEVELOPMENT: 'development',
    CONTENT_PROCESSING: 'content_processing',
    DEBUGGING: 'debugging',
    DOCUMENTATION: 'documentation',
    EDUCATION: 'education',
    RESEARCH: 'research',
    SYSTEM: 'system',
};
/**
 * Common error messages
 */
export const ERROR_MESSAGES = {
    REQUIRED_FIELD: (field) => `Field '${field}' is required but was not provided`,
    INVALID_FORMAT: (field, format) => `Field '${field}' must match format: ${format}`,
    LENGTH_CONSTRAINT: (field, min, max) => `Field '${field}' must be between ${min} and ${max} characters`,
    UNKNOWN_ACTION: (action, validActions) => `Unknown action: ${action}. Valid actions: ${validActions.join(', ')}`,
    UNKNOWN_OPERATION: (operation, validOperations) => `Unknown operation: ${operation}. Valid operations: ${validOperations.join(', ')}`,
    NOT_FOUND: (type, id) => `${type} not found: ${id}`,
    ALREADY_EXISTS: (type, id) => `${type} already exists: ${id}`,
};
/**
 * Success messages
 */
export const SUCCESS_MESSAGES = {
    CREATED: (type, id) => `${type} created successfully: ${id}`,
    UPDATED: (type, id) => `${type} updated successfully: ${id}`,
    DELETED: (type, id) => `${type} deleted successfully: ${id}`,
    OPERATION_COMPLETE: (operation) => `${operation} completed successfully`,
};
/**
 * Documentation URLs (when available)
 */
export const DOCUMENTATION = {
    PROMPT_CREATION: '/docs/prompts/creation',
    CHAIN_CREATION: '/docs/prompts/chains',
    FILTERING: '/docs/prompts/filtering',
    FRAMEWORKS: '/docs/frameworks',
    TROUBLESHOOTING: '/docs/troubleshooting',
};
//# sourceMappingURL=constants.js.map
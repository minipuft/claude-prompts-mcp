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
} as const;

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
} as const;

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
} as const;

/**
 * Output formats
 */
export const OUTPUT_FORMATS = {
  COMPACT: 'compact',
  DETAILED: 'detailed',
  JSON: 'json',
  MARKDOWN: 'markdown',
} as const;

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
} as const;

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
} as const;

/**
 * Validation patterns
 */
export const VALIDATION_PATTERNS = {
  PROMPT_ID: /^[a-zA-Z0-9_-]+$/,
  SESSION_ID: /^[a-zA-Z0-9_-]+$/,
  ARGUMENT_NAME: /^[a-zA-Z_][a-zA-Z0-9_]*$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  URL: /^https?:\/\/.+/,
} as const;

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
} as const;

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
} as const;

/**
 * Framework types
 */
export const FRAMEWORKS = {
  CAGEERF: 'CAGEERF',
  REACT: 'ReACT',
  FIVE_W_ONE_H: '5W1H',
  SCAMPER: 'SCAMPER',
} as const;

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
} as const;

/**
 * Common error messages
 */
export const ERROR_MESSAGES = {
  REQUIRED_FIELD: (field: string) => `Field '${field}' is required but was not provided`,
  INVALID_FORMAT: (field: string, format: string) =>
    `Field '${field}' must match format: ${format}`,
  LENGTH_CONSTRAINT: (field: string, min: number, max: number) =>
    `Field '${field}' must be between ${min} and ${max} characters`,
  UNKNOWN_ACTION: (action: string, validActions: string[]) =>
    `Unknown action: ${action}. Valid actions: ${validActions.join(', ')}`,
  UNKNOWN_OPERATION: (operation: string, validOperations: string[]) =>
    `Unknown operation: ${operation}. Valid operations: ${validOperations.join(', ')}`,
  NOT_FOUND: (type: string, id: string) => `${type} not found: ${id}`,
  ALREADY_EXISTS: (type: string, id: string) => `${type} already exists: ${id}`,
} as const;

/**
 * Success messages
 */
export const SUCCESS_MESSAGES = {
  CREATED: (type: string, id: string) => `${type} created successfully: ${id}`,
  UPDATED: (type: string, id: string) => `${type} updated successfully: ${id}`,
  DELETED: (type: string, id: string) => `${type} deleted successfully: ${id}`,
  OPERATION_COMPLETE: (operation: string) => `${operation} completed successfully`,
} as const;

/**
 * Documentation URLs (when available)
 */
export const DOCUMENTATION = {
  PROMPT_CREATION: '/docs/prompts/creation',
  CHAIN_CREATION: '/docs/prompts/chains',
  FILTERING: '/docs/prompts/filtering',
  FRAMEWORKS: '/docs/frameworks',
  TROUBLESHOOTING: '/docs/troubleshooting',
} as const;

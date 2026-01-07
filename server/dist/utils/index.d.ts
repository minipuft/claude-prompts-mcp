/**
 * Utility Functions Module
 * Consolidates all utility functions used across the application
 */
export * from './errorHandling.js';
export * from './jsonUtils.js';
export * from './chainUtils.js';
export * from './constants.js';
export * from './yaml/index.js';
export * from './resource-loader-types.js';
export * from './atomic-file-write.js';
export * from '../frameworks/index.js';
export { GateLoader, createGateLoader, GateValidator, createGateValidator, LightweightGateSystem, createLightweightGateSystem, } from '../gates/index.js';
export type { LightweightGateDefinition, GatePassCriteria, ValidationCheck, ValidationContext, GateActivationResult, } from '../gates/index.js';
/**
 * Clear the require cache for prompt-related modules
 */
export declare function clearRequireCache(): void;
/**
 * Force garbage collection if available
 */
export declare function forceGarbageCollection(): boolean;
/**
 * Delay execution for a specified number of milliseconds
 */
export declare function delay(ms: number): Promise<void>;
/**
 * Create a unique identifier
 */
export declare function createUniqueId(prefix?: string): string;
/**
 * Safely stringify an object, handling circular references
 */
export declare function safeStringify(obj: any, indent?: number): string;
/**
 * Check if a string is valid JSON
 */
export declare function isValidJson(str: string): boolean;
/**
 * Escape JSON string for safe processing through Nunjucks templates
 * Replaces problematic characters that Nunjucks might interpret as template syntax
 */
export declare function escapeJsonForNunjucks(jsonStr: string): string;
/**
 * Unescape JSON string after Nunjucks processing
 * Reverses the escaping applied by escapeJsonForNunjucks
 */
export declare function unescapeJsonFromNunjucks(escapedStr: string): string;
/**
 * Safely parse JSON with Nunjucks compatibility
 * Attempts to parse JSON, applying escaping if necessary
 */
export declare function safeJsonParse(jsonStr: string): {
    success: boolean;
    data?: any;
    error?: string;
};
/**
 * Truncate text to a maximum length
 */
export declare function truncateText(text: string, maxLength: number, suffix?: string): string;
/**
 * Convert camelCase to kebab-case
 */
export declare function camelToKebab(str: string): string;
/**
 * Convert kebab-case to camelCase
 */
export declare function kebabToCamel(str: string): string;
/**
 * Validate email format
 */
export declare function isValidEmail(email: string): boolean;
/**
 * Parse command line arguments into key-value pairs
 */
export declare function parseArgs(args: string[]): Record<string, string>;
/**
 * Mock logger for testing purposes
 * Uses stderr to avoid corrupting STDIO protocol
 */
export declare class MockLogger {
    info(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    debug(message: string, ...args: any[]): void;
    setTransport(_transport: string): void;
    setDebugEnabled(_enabled: boolean): void;
    logStartupInfo(transport: string, config: any): void;
    logMemoryUsage(): void;
}

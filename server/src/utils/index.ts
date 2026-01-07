// @lifecycle canonical - Utility barrel plus compatibility exports for frameworks and gates.
/**
 * Utility Functions Module
 * Consolidates all utility functions used across the application
 */

// Re-export existing utilities
export * from './errorHandling.js';
export * from './jsonUtils.js';
export * from './chainUtils.js';
export * from './constants.js';
export * from './yaml/index.js';
export * from './resource-loader-types.js';
export * from './atomic-file-write.js';

// Re-export framework system from new locations (maintaining backward compatibility)
export * from '../frameworks/index.js';

// Re-export gate system from new locations (maintaining backward compatibility)
// Note: Selective export to avoid ValidationResult conflicts
export {
  GateLoader,
  createGateLoader,
  GateValidator,
  createGateValidator,
  LightweightGateSystem,
  createLightweightGateSystem,
} from '../gates/index.js';
export type {
  LightweightGateDefinition,
  GatePassCriteria,
  ValidationCheck,
  ValidationContext,
  GateActivationResult,
} from '../gates/index.js';

// Template system removed - functionality moved to methodology guides

// Additional utilities extracted from index.ts

/**
 * Clear the require cache for prompt-related modules
 */
export function clearRequireCache(): void {
  // Get all cached module paths
  const cachedModulePaths = Object.keys(require.cache);

  // Filter for prompt files and configs
  const promptPaths = cachedModulePaths.filter(
    (modulePath) =>
      modulePath.includes('prompts/') ||
      modulePath.includes('prompts.json') ||
      modulePath.endsWith('.md')
  );

  // Clear them from cache
  promptPaths.forEach((modulePath) => {
    delete require.cache[modulePath];
  });

  // Use stderr to avoid corrupting STDIO protocol
  console.error(`Cleared ${promptPaths.length} prompt-related modules from require cache`);
}

/**
 * Force garbage collection if available
 */
export function forceGarbageCollection(): boolean {
  if (global.gc) {
    try {
      global.gc();
      return true;
    } catch (gcError) {
      console.warn('Could not force garbage collection:', gcError);
      return false;
    }
  }
  return false;
}

/**
 * Delay execution for a specified number of milliseconds
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a unique identifier
 */
export function createUniqueId(prefix: string = ''): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
}

/**
 * Safely stringify an object, handling circular references
 */
export function safeStringify(obj: any, indent: number = 0): string {
  try {
    return JSON.stringify(obj, null, indent);
  } catch (error) {
    // Handle circular references
    const seen = new Set();
    return JSON.stringify(
      obj,
      (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
        }
        return value;
      },
      indent
    );
  }
}

/**
 * Check if a string is valid JSON
 */
export function isValidJson(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Escape JSON string for safe processing through Nunjucks templates
 * Replaces problematic characters that Nunjucks might interpret as template syntax
 */
export function escapeJsonForNunjucks(jsonStr: string): string {
  return jsonStr
    .replace(/\{\{/g, '\\{\\{') // Escape Nunjucks variable syntax
    .replace(/\}\}/g, '\\}\\}') // Escape Nunjucks variable syntax
    .replace(/\{%/g, '\\{\\%') // Escape Nunjucks tag syntax
    .replace(/%\}/g, '\\%\\}') // Escape Nunjucks tag syntax
    .replace(/\{#/g, '\\{\\#') // Escape Nunjucks comment syntax
    .replace(/#\}/g, '\\#\\}'); // Escape Nunjucks comment syntax
}

/**
 * Unescape JSON string after Nunjucks processing
 * Reverses the escaping applied by escapeJsonForNunjucks
 */
export function unescapeJsonFromNunjucks(escapedStr: string): string {
  return escapedStr
    .replace(/\\{\\{/g, '{{') // Restore Nunjucks variable syntax
    .replace(/\\}\\}/g, '}}') // Restore Nunjucks variable syntax
    .replace(/\\{\\%/g, '{%') // Restore Nunjucks tag syntax
    .replace(/\\%\\}/g, '%}') // Restore Nunjucks tag syntax
    .replace(/\\{\\#/g, '{#') // Restore Nunjucks comment syntax
    .replace(/\\#\\}/g, '#}'); // Restore Nunjucks comment syntax
}

/**
 * Safely parse JSON with Nunjucks compatibility
 * Attempts to parse JSON, applying escaping if necessary
 */
export function safeJsonParse(jsonStr: string): { success: boolean; data?: any; error?: string } {
  try {
    // First try direct parsing
    const data = JSON.parse(jsonStr);
    return { success: true, data };
  } catch (directError) {
    try {
      // If direct parsing fails, try with unescaping
      const unescaped = unescapeJsonFromNunjucks(jsonStr);
      const data = JSON.parse(unescaped);
      return { success: true, data };
    } catch (unescapeError) {
      return {
        success: false,
        error: `JSON parsing failed: ${directError instanceof Error ? directError.message : String(directError)}`,
      };
    }
  }
}

/**
 * Truncate text to a maximum length
 */
export function truncateText(text: string, maxLength: number, suffix: string = '...'): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * Convert camelCase to kebab-case
 */
export function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Convert kebab-case to camelCase
 */
export function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (g) => (g[1] ? g[1].toUpperCase() : ''));
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Parse command line arguments into key-value pairs
 */
export function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg?.startsWith('--')) {
      continue;
    }

    const [key, value] = arg.split('=');
    const normalizedKey = key?.substring(2);
    if (!normalizedKey) {
      continue;
    }

    if (value !== undefined) {
      parsed[normalizedKey] = value;
    } else if (i + 1 < args.length) {
      const nextArg = args[i + 1];
      if (nextArg !== undefined && !nextArg.startsWith('--')) {
        parsed[normalizedKey] = nextArg;
        i++;
        continue;
      }
      parsed[normalizedKey] = 'true';
    } else {
      parsed[normalizedKey] = 'true';
    }
  }

  return parsed;
}

/**
 * Mock logger for testing purposes
 * Uses stderr to avoid corrupting STDIO protocol
 */
export class MockLogger {
  info(message: string, ...args: any[]): void {
    console.error(`[INFO] ${message}`, ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(`[ERROR] ${message}`, ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(`[WARN] ${message}`, ...args);
  }

  debug(message: string, ...args: any[]): void {
    console.error(`[DEBUG] ${message}`, ...args);
  }

  setTransport(_transport: string): void {
    // Mock implementation - no-op
  }

  setDebugEnabled(_enabled: boolean): void {
    // Mock implementation - no-op
  }

  logStartupInfo(transport: string, config: any): void {
    this.info(`Mock startup - Transport: ${transport}`);
    this.debug('Mock config:', JSON.stringify(config, null, 2));
  }

  logMemoryUsage(): void {
    this.info(`Mock memory usage: ${JSON.stringify(process.memoryUsage())}`);
  }
}

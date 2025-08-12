/**
 * Utility Functions Module
 * Consolidates all utility functions used across the application
 */

// Re-export existing utilities
export * from "./errorHandling.js";
export * from "./jsonUtils.js";

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
      modulePath.includes("prompts/") ||
      modulePath.includes("prompts.json") ||
      modulePath.endsWith(".md")
  );

  // Clear them from cache
  promptPaths.forEach((modulePath) => {
    delete require.cache[modulePath];
  });

  console.log(
    `Cleared ${promptPaths.length} prompt-related modules from require cache`
  );
}

/**
 * Get available tools information for template processing
 */
export function getAvailableTools(): string {
  // This is a placeholder implementation. In a real implementation,
  // you would dynamically fetch available tools from the MCP server.
  // For now, we'll return a static instruction about tools usage.
  return `You have access to a set of tools to help solve tasks.
Use the following format to utilize these tools:

<tool_calls>
<tool_call name="TOOL_NAME">
<tool_parameters>
PARAMETERS_IN_JSON_FORMAT
</tool_parameters>
</tool_call>
</tool_calls>

Always check if a tool is appropriate for the task at hand before using it.
Use tools only when necessary to complete the task.`;
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
      console.warn("Could not force garbage collection:", gcError);
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
export function createUniqueId(prefix: string = ""): string {
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
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) {
            return "[Circular]";
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
 * Truncate text to a maximum length
 */
export function truncateText(
  text: string,
  maxLength: number,
  suffix: string = "..."
): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * Convert camelCase to kebab-case
 */
export function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * Convert kebab-case to camelCase
 */
export function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
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
    if (arg.startsWith("--")) {
      const [key, value] = arg.split("=");
      if (value !== undefined) {
        parsed[key.substring(2)] = value;
      } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        parsed[key.substring(2)] = args[i + 1];
        i++;
      } else {
        parsed[key.substring(2)] = "true";
      }
    }
  }

  return parsed;
}

/**
 * Mock logger for testing purposes
 */
export class MockLogger {
  info(message: string, ...args: any[]): void {
    console.log(`[INFO] ${message}`, ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(`[ERROR] ${message}`, ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(`[WARN] ${message}`, ...args);
  }

  debug(message: string, ...args: any[]): void {
    console.log(`[DEBUG] ${message}`, ...args);
  }

  setTransport(_transport: string): void {
    // Mock implementation - no-op
  }

  setDebugEnabled(_enabled: boolean): void {
    // Mock implementation - no-op
  }

  logStartupInfo(transport: string, config: any): void {
    this.info(`Mock startup - Transport: ${transport}`);
    this.debug("Mock config:", JSON.stringify(config, null, 2));
  }

  logMemoryUsage(): void {
    this.info(`Mock memory usage: ${JSON.stringify(process.memoryUsage())}`);
  }
}

/**
 * Server Root Detection and Startup Utilities
 * Robust server root directory detection for different execution contexts:
 * - Local development (node dist/index.js)
 * - Claude Desktop (absolute path invocation)
 * - Global npm install (npm install -g)
 * - npx execution (temporary install)
 * - Local npm install (node_modules/.bin/)
 */
/**
 * Server Root Detector
 * Handles robust server root directory detection using multiple strategies
 * optimized for different execution contexts (npm install, Claude Desktop, development)
 */
export declare class ServerRootDetector {
    private isVerbose;
    private isQuiet;
    private hasWarnedEnvDeprecation;
    /**
     * Determine the server root directory using multiple strategies
     * Priority order:
     * 1. Package Resolution - Find package.json with matching name (npm installs)
     * 2. Script Entry Point - Resolve symlinks from process.argv[1]
     * 3. Module URL - Walk up from import.meta.url
     * 4. CWD Fallback - process.cwd() patterns (last resort)
     */
    determineServerRoot(): Promise<string>;
    /**
     * Strategy 1: Package Resolution (Primary for npm installs)
     * Walks up from the current module to find package.json with matching name
     */
    private resolveFromPackage;
    /**
     * Strategy 2: Script Entry Point (Claude Desktop, direct node)
     * Resolves symlinks to find actual package location
     */
    private resolveFromScriptPath;
    /**
     * Strategy 3: Module URL Resolution
     * Uses import.meta.url to find package root
     */
    private resolveFromModuleUrl;
    /**
     * Strategy 4: CWD Fallback (Last resort, development only)
     */
    private resolveFromCwd;
    /**
     * Validate that a directory is a valid server root
     * Checks for required files and directories
     */
    private validateServerRoot;
    /**
     * Check if a path exists (file or directory)
     */
    private pathExists;
    /**
     * Log diagnostic information for troubleshooting
     */
    private logDiagnosticInfo;
    /**
     * Generate actionable error message when all strategies fail
     */
    private generateErrorMessage;
}

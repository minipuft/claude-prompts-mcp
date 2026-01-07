#!/usr/bin/env node
// @lifecycle canonical - Main MCP server entrypoint.
/**
 * MCP Claude Prompts Server - Main Entry Point
 * Minimal entry point with comprehensive error handling, health checks, and validation
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ConfigManager } from './config/index.js';
import { startApplication } from './runtime/application.js';
import { RuntimeLaunchOptions, resolveRuntimeLaunchOptions } from './runtime/options.js';

import type { Logger } from './logging/index.js';
import type { Application } from './runtime/application.js';
import type { HealthReport } from './runtime/health.js';

const EMPTY_HEALTH_REPORT: HealthReport = {
  healthy: false,
  modules: {
    foundation: false,
    dataLoaded: false,
    modulesInitialized: false,
    serverRunning: false,
  },
  details: {
    promptsLoaded: 0,
    categoriesLoaded: 0,
    moduleStatus: {},
  },
  issues: ['Health not yet evaluated'],
};

interface TrackedHealth {
  lastCheck: number;
  report: HealthReport;
}

type DiagnosticStatus =
  | ({ available: true; timestamp: string } & ReturnType<Application['getDiagnosticInfo']>)
  | { available: false; reason: string; timestamp: string };

/**
 * Application state for health monitoring and rollback
 */
let applicationHealth: TrackedHealth = {
  lastCheck: Date.now(),
  report: EMPTY_HEALTH_REPORT,
};

let orchestrator: Application | null = null;
let logger: Logger | null = null;
let isShuttingDown = false;

/**
 * Validate application health
 */
async function validateApplicationHealth(): Promise<boolean> {
  try {
    if (orchestrator === null) {
      applicationHealth = {
        lastCheck: Date.now(),
        report: EMPTY_HEALTH_REPORT,
      };
      return false;
    }

    // Use the orchestrator's comprehensive health validation
    const healthCheck = orchestrator.validateHealth();

    // Update health state with detailed information
    applicationHealth = {
      report: healthCheck,
      lastCheck: Date.now(),
    };

    // Log health issues if any
    if (!healthCheck.healthy && logger !== null && healthCheck.issues.length > 0) {
      logger.warn('Health validation found issues:', healthCheck.issues);
    }

    return healthCheck.healthy;
  } catch (error) {
    if (logger !== null) {
      logger.error('Health validation failed:', error);
    }
    return false;
  }
}

/**
 * Rollback mechanism for startup failures
 */
async function rollbackStartup(error: Error): Promise<void> {
  // Use stderr for error output to avoid interfering with stdio transport
  console.error('Critical startup failure, attempting rollback:', error);

  try {
    if (orchestrator !== null) {
      console.error('Attempting graceful shutdown of partial initialization...');
      await orchestrator.shutdown();
      orchestrator = null;
    }

    // Reset health state
    applicationHealth = {
      lastCheck: Date.now(),
      report: EMPTY_HEALTH_REPORT,
    };

    console.error('Rollback completed');
  } catch (rollbackError) {
    console.error('Error during rollback:', rollbackError);
  }
}

/**
 * Setup periodic health checks
 * SUPPRESSED in test environments to prevent hanging processes
 */
function setupHealthMonitoring(runtimeOptions: RuntimeLaunchOptions): void {
  if (logger === null) return;

  // Skip health monitoring in test environments to prevent hanging processes
  if (runtimeOptions.testEnvironment) {
    logger.debug('Health monitoring suppressed in test environment');
    return;
  }

  const runHealthCheck = async (): Promise<void> => {
    if (isShuttingDown || logger === null) return;
    if (orchestrator === null) return;
    const activeOrchestrator = orchestrator;

    try {
      const isHealthy = await validateApplicationHealth();
      if (!isHealthy) {
        logger.warn('Health check failed - application may be degraded');

        // Log current status for debugging
        const diagnostics = activeOrchestrator.getDiagnosticInfo();
        logger.warn('Diagnostic information:', {
          health: diagnostics.health,
          performance: diagnostics.performance,
          errors: diagnostics.errors,
        });
      } else {
        // Periodic performance logging (every 5th health check = 2.5 minutes)
        if (Date.now() % (5 * 30000) < 30000) {
          const performance = activeOrchestrator.getPerformanceMetrics();
          logger.info('Performance metrics:', {
            uptime: `${Math.floor(performance.uptime / 60)} minutes`,
            memoryUsage: `${Math.round(performance.memoryUsage.heapUsed / 1024 / 1024)}MB`,
            prompts: performance.application.promptsLoaded,
            categories: performance.application.categoriesLoaded,
          });
        }
      }
    } catch (error) {
      logger.error('Error during health check:', error);

      // Emergency diagnostic collection
      try {
        const emergency = getDetailedDiagnostics();
        logger.error('Emergency diagnostics:', emergency);
      } catch (diagError) {
        logger.error('Failed to collect emergency diagnostics:', diagError);
      }
    }
  };

  // Health check every 30 seconds
  setInterval(() => {
    void runHealthCheck();
  }, 30000);

  logger.info('Health monitoring enabled (30-second intervals with performance tracking)');
}

/**
 * Setup comprehensive error handlers
 */
function setupErrorHandlers(): void {
  const shutdownOnError = async (
    consoleMessage: string,
    logMessage: string,
    error: unknown
  ): Promise<void> => {
    console.error(consoleMessage, error);

    if (logger !== null) {
      logger.error(logMessage, error);
    }

    isShuttingDown = true;

    try {
      if (orchestrator !== null) {
        await orchestrator.shutdown();
      }
    } catch (shutdownError) {
      console.error('Error during emergency shutdown:', shutdownError);
    }

    process.exit(1);
  };

  // Handle uncaught exceptions with rollback
  process.on('uncaughtException', (error) => {
    void shutdownOnError(
      'Uncaught exception detected:',
      'Uncaught exception - initiating emergency shutdown:',
      error
    );
  });

  // Handle unhandled promise rejections with rollback
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled promise rejection at:', promise, 'reason:', reason);

    void shutdownOnError(
      'Unhandled promise rejection at:',
      'Unhandled promise rejection - initiating emergency shutdown:',
      { reason, promise }
    );
  });

  // Handle SIGINT (Ctrl+C) gracefully
  process.on('SIGINT', () => {
    if (logger !== null) {
      logger.info('Received SIGINT (Ctrl+C), initiating graceful shutdown...');
    } else {
      console.error('Received SIGINT (Ctrl+C), initiating graceful shutdown...');
    }

    void gracefulShutdown(0);
  });

  // Handle SIGTERM gracefully
  process.on('SIGTERM', () => {
    if (logger !== null) {
      logger.info('Received SIGTERM, initiating graceful shutdown...');
    } else {
      console.error('Received SIGTERM, initiating graceful shutdown...');
    }

    void gracefulShutdown(0);
  });
}

/**
 * Graceful shutdown with validation
 */
async function gracefulShutdown(exitCode: number = 0): Promise<void> {
  if (isShuttingDown) {
    return; // Prevent multiple shutdown attempts
  }

  isShuttingDown = true;

  try {
    if (logger !== null) {
      logger.info('Starting graceful shutdown sequence...');
    }

    // Validate current state before shutdown
    if (orchestrator !== null) {
      const status = orchestrator.getStatus();
      if (logger !== null) {
        logger.info('Application status before shutdown:', status);
      }

      // Perform graceful shutdown
      await orchestrator.shutdown();

      if (logger !== null) {
        logger.info('Orchestrator shutdown completed successfully');
      }
    }

    // Final health state update
    applicationHealth = {
      lastCheck: Date.now(),
      report: EMPTY_HEALTH_REPORT,
    };

    if (logger !== null) {
      logger.info('Graceful shutdown completed successfully');
    } else {
      console.error('Graceful shutdown completed successfully');
    }
  } catch (error) {
    if (logger !== null) {
      logger.error('Error during graceful shutdown:', error);
    } else {
      console.error('Error during graceful shutdown:', error);
    }
    exitCode = 1;
  }

  process.exit(exitCode);
}

/**
 * Display help information
 */
function showHelp(): void {
  console.error(`
MCP Claude Prompts Server v1.0.0 - Configurable Workspace Support

USAGE:
  npx claude-prompts [OPTIONS]
  node dist/index.js [OPTIONS]

QUICK START:
  npx claude-prompts --init=~/my-prompts    Create a new workspace with starter prompts

  Then add MCP_WORKSPACE to your Claude Desktop config and restart.
  Claude can update your prompts via resource_manager - no manual editing needed!

PATH OPTIONS:
  --workspace=/path       Base directory for user assets (prompts, config, etc.)
  --config=/path          Direct path to config.json
  --prompts=/path         Direct path to prompts configuration file
  --methodologies=/path   Custom methodologies directory
  --gates=/path           Custom gates directory

RUNTIME OPTIONS:
  --init=/path            Create a new workspace with starter prompts at the specified path
  --transport=TYPE        Transport type: stdio (default) or sse
  --log-level=LEVEL       Log level: debug, info, warn, error
  --quiet                 Minimal output mode (production-friendly)
  --verbose               Detailed diagnostics and strategy information
  --debug-startup         Alias for --verbose with extra debugging
  --startup-test          Validate startup and exit (for testing)
  --help                  Show this help message

ENVIRONMENT VARIABLES:
  MCP_WORKSPACE            Base workspace directory (same as --workspace)
  MCP_CONFIG_PATH          Direct path to config.json (same as --config)
  MCP_PROMPTS_PATH         Direct path to prompts config (same as --prompts)
  MCP_METHODOLOGIES_PATH   Custom methodologies directory
  MCP_GATES_PATH           Custom gates directory
  LOG_LEVEL                Override log level (debug, info, warn, error)

PRIORITY ORDER:
  CLI flags > Environment variables > Workspace subdirectory > Package defaults

WORKSPACE STRUCTURE:
  Your workspace can contain:
    prompts/                   - Your custom prompts (directory format)
    config.json                 - Server configuration overrides
    methodologies/              - Custom methodology definitions
    gates/                      - Custom gate definitions

EXAMPLES:
  # Use a custom workspace
  npx claude-prompts --workspace=/home/user/my-prompts

  # Override specific paths
  npx claude-prompts --prompts=/path/to/prompts

  # Via environment variables
  MCP_WORKSPACE=/home/user/my-prompts npx claude-prompts

  # Claude Desktop configuration (recommended)
  # Add to ~/.config/claude/claude_desktop_config.json:
  {
    "mcpServers": {
      "claude-prompts": {
        "command": "npx",
        "args": ["-y", "claude-prompts@latest"],
        "env": {
          "MCP_WORKSPACE": "/home/user/my-mcp-workspace"
        }
      }
    }
  }

STARTUP MODES:
  Production:    npx claude-prompts --quiet
  Development:   npx claude-prompts --verbose --transport=sse
  Debugging:     npx claude-prompts --debug-startup
  Testing:       npx claude-prompts --startup-test

For more information: https://github.com/minipuft/claude-prompts-mcp
`);
}

/**
 * Starter prompts for new workspaces
 */
type StarterPrompt = {
  id: string;
  category: string;
  description: string;
  userMessageTemplate: string;
  arguments: Array<{ name: string; type: 'string'; description: string }>;
};

const STARTER_PROMPTS: StarterPrompt[] = [
  {
    id: 'quick_review',
    category: 'development',
    description: 'Fast review focusing on bugs and security issues.',
    userMessageTemplate:
      'Review this code for bugs, security issues, and obvious improvements. Be concise and actionable.\n\n```\n{{code}}\n```',
    arguments: [{ name: 'code', type: 'string', description: 'Code to review.' }],
  },
  {
    id: 'explain',
    category: 'development',
    description: 'Clear explanation of how code works.',
    userMessageTemplate:
      'Explain how this code works. Start with a one-sentence summary, then break down the key parts.\n\n```\n{{code}}\n```',
    arguments: [{ name: 'code', type: 'string', description: 'Code to explain.' }],
  },
  {
    id: 'improve',
    category: 'development',
    description: 'Actionable suggestions to improve code quality.',
    userMessageTemplate:
      'Suggest improvements for this code. Focus on:\n- Readability\n- Performance\n- Best practices\n\nProvide before/after examples where helpful.\n\n```\n{{code}}\n```',
    arguments: [{ name: 'code', type: 'string', description: 'Code to improve.' }],
  },
];

function formatStarterPromptYaml(prompt: StarterPrompt): string {
  const descriptionLines = prompt.description.split('\n').map((line) => `  ${line}`);
  const argsLines = prompt.arguments.flatMap((arg) => [
    `  - name: ${arg.name}`,
    `    type: ${arg.type}`,
    `    description: ${arg.description}`,
  ]);

  return [
    `id: ${prompt.id}`,
    `name: ${prompt.id}`,
    `category: ${prompt.category}`,
    `description: >-`,
    ...descriptionLines,
    `userMessageTemplateFile: user-message.md`,
    `arguments:`,
    ...argsLines,
    '',
  ].join('\n');
}

/**
 * Initialize a new workspace with starter prompts
 */
function initWorkspace(targetPath: string): { success: boolean; message: string } {
  try {
    const workspacePath = resolve(targetPath);
    const promptsDir = join(workspacePath, 'resources', 'prompts');

    // Check if workspace already exists (check both new and legacy paths)
    const legacyPromptsDir = join(workspacePath, 'prompts');
    if (
      (existsSync(promptsDir) && readdirSync(promptsDir).length > 0) ||
      (existsSync(legacyPromptsDir) && readdirSync(legacyPromptsDir).length > 0)
    ) {
      return {
        success: false,
        message: `Workspace already exists at ${workspacePath}\nFound prompts directory (non-empty)`,
      };
    }

    // Create directories
    mkdirSync(promptsDir, { recursive: true });

    const createdFiles: string[] = [];
    for (const prompt of STARTER_PROMPTS) {
      const promptDir = join(promptsDir, prompt.category, prompt.id);
      mkdirSync(promptDir, { recursive: true });

      const promptYamlPath = join(promptDir, 'prompt.yaml');
      writeFileSync(promptYamlPath, formatStarterPromptYaml(prompt), 'utf8');
      createdFiles.push(promptYamlPath);

      const userMessagePath = join(promptDir, 'user-message.md');
      writeFileSync(userMessagePath, `${prompt.userMessageTemplate.trimEnd()}\n`, 'utf8');
      createdFiles.push(userMessagePath);
    }

    return {
      success: true,
      message: `
✅ Workspace created at: ${workspacePath}

Created files:
  ${createdFiles.map((f) => `\n  ${f}`).join('')}

Next steps:

1. Add to your Claude Desktop config (~/.config/claude/claude_desktop_config.json):

   {
     "mcpServers": {
       "claude-prompts": {
         "command": "npx",
         "args": ["-y", "claude-prompts@latest"],
         "env": {
           "MCP_WORKSPACE": "${workspacePath}"
         }
       }
     }
   }

2. Restart Claude Desktop

3. Test with: resource_manager(resource_type: "prompt", action: "list")

4. Edit prompts directly or ask Claude:
   "Update the quick_review prompt to also check for TypeScript errors"

   Claude will use resource_manager to update your prompts automatically!

📖 Full docs: https://github.com/minipuft/claude-prompts-mcp
`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to create workspace: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Parse and validate command line arguments
 */
function parseCommandLineArgs(): { shouldExit: boolean; exitCode: number } {
  const args = process.argv.slice(2);

  // Check for help flag
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return { shouldExit: true, exitCode: 0 };
  }

  // Check for init flag
  const initArg = args.find((arg) => arg.startsWith('--init'));
  if (initArg !== undefined) {
    // Parse the target path
    let targetPath: string | undefined;
    if (initArg.includes('=')) {
      targetPath = initArg.split('=')[1];
    } else {
      // Check if next argument is a path (not another flag)
      const initIndex = args.indexOf(initArg);
      const nextArg = args[initIndex + 1];
      if (nextArg !== undefined && nextArg.length > 0 && !nextArg.startsWith('-')) {
        targetPath = nextArg;
      } else {
        console.error('Error: --init requires a path. Usage: --init=/path/to/workspace');
        console.error('Example: npx claude-prompts --init=~/my-prompts');
        return { shouldExit: true, exitCode: 1 };
      }
    }

    if (targetPath === undefined || targetPath.length === 0) {
      console.error('Error: --init requires a path. Usage: --init=/path/to/workspace');
      return { shouldExit: true, exitCode: 1 };
    }

    // Expand ~ to home directory
    if (targetPath.startsWith('~')) {
      const homedir = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
      targetPath = targetPath.replace('~', homedir);
    }

    const result = initWorkspace(targetPath);
    console.log(result.message);
    return { shouldExit: true, exitCode: result.success ? 0 : 1 };
  }

  // Validate transport argument
  const transportArg = args.find((arg) => arg.startsWith('--transport='));
  if (transportArg !== undefined) {
    const transport = transportArg.slice('--transport='.length);
    if (!['stdio', 'sse', 'streamable-http'].includes(transport)) {
      console.error(
        `Error: Invalid transport '${transport}'. Supported: stdio, sse, streamable-http`
      );
      console.error('Use --help for usage information');
      return { shouldExit: true, exitCode: 1 };
    }
  }

  // Validate log-level argument
  const logLevelArg = args.find((arg) => arg.startsWith('--log-level='));
  if (logLevelArg !== undefined) {
    const level = logLevelArg.slice('--log-level='.length).toLowerCase();
    if (!['debug', 'info', 'warn', 'error'].includes(level)) {
      console.error(`Error: Invalid log level '${level}'. Supported: debug, info, warn, error`);
      console.error('Use --help for usage information');
      return { shouldExit: true, exitCode: 1 };
    }
  }

  // Validate that conflicting flags aren't used together
  const isQuiet = args.includes('--quiet');
  const isVerbose = args.includes('--verbose') || args.includes('--debug-startup');

  if (isQuiet && isVerbose) {
    console.error('Error: Cannot use --quiet and --verbose flags together');
    console.error('Use --help for usage information');
    return { shouldExit: true, exitCode: 1 };
  }

  // Validate path flags have values (not just --workspace without =)
  const pathFlags = ['--workspace', '--config', '--prompts', '--methodologies', '--gates'];
  for (const flag of pathFlags) {
    const matchingArg = args.find((arg) => arg.startsWith(flag));
    if (matchingArg !== undefined && !matchingArg.includes('=')) {
      console.error(`Error: ${flag} requires a value. Use ${flag}=/path/to/directory`);
      console.error('Use --help for usage information');
      return { shouldExit: true, exitCode: 1 };
    }
  }

  return { shouldExit: false, exitCode: 0 };
}

/**
 * Main application entry point with comprehensive error handling and validation
 */
async function main(): Promise<void> {
  try {
    // Parse and validate command line arguments
    const { shouldExit, exitCode } = parseCommandLineArgs();
    if (shouldExit) {
      process.exit(exitCode);
    }

    // Check for startup validation mode (for GitHub Actions)
    const fullArgv = process.argv;
    const args = fullArgv.slice(2);
    const runtimeOptions = resolveRuntimeLaunchOptions(args, fullArgv);
    const isStartupTest = runtimeOptions.startupTest;
    const isVerbose = runtimeOptions.verbose;

    if (isStartupTest && isVerbose) {
      // Always use stderr to avoid corrupting STDIO protocol
      const debugLog = console.error;
      debugLog('DEBUG: Running in startup validation mode');
      debugLog(`DEBUG: Platform: ${process.platform}`);
      debugLog(`DEBUG: Node.js version: ${process.version}`);
      debugLog(`DEBUG: Working directory: ${process.cwd()}`);
      debugLog(`DEBUG: MCP_WORKSPACE: ${process.env['MCP_WORKSPACE'] ?? 'not set'}`);
      debugLog(`DEBUG: MCP_PROMPTS_PATH: ${process.env['MCP_PROMPTS_PATH'] ?? 'not set'}`);
    }

    // Setup error handlers first
    setupErrorHandlers();

    // Use stderr for all logging to avoid corrupting STDIO protocol
    if (isVerbose) {
      console.error('Starting MCP Claude Prompts Server...');
    }

    // Initialize the application using the orchestrator
    const debugLog = console.error;
    if (isVerbose) {
      debugLog('DEBUG: About to call startApplication()...');
    }
    try {
      orchestrator = await startApplication(runtimeOptions);
      if (isVerbose) {
        debugLog('DEBUG: startApplication() completed successfully');
      }
    } catch (startupError) {
      const error = startupError instanceof Error ? startupError : new Error(String(startupError));
      if (isVerbose) {
        debugLog('DEBUG: startApplication() failed with error:', error.message);
        debugLog('DEBUG: Error stack:', error.stack);
      }

      // Additional diagnostics for Windows
      if (isVerbose && process.platform === 'win32') {
        debugLog('DEBUG: Windows-specific diagnostics:');
        debugLog(`DEBUG: Process argv: ${JSON.stringify(process.argv)}`);
        debugLog(
          `DEBUG: Environment keys: ${Object.keys(process.env)
            .filter((k) => k.startsWith('MCP_'))
            .join(', ')}`
        );

        // Check if paths exist
        const fs = await import('fs');
        const path = await import('path');

        const workspace = process.env['MCP_WORKSPACE'] ?? process.cwd();
        debugLog(`DEBUG: Checking workspace: ${workspace}`);
        debugLog(`DEBUG: Workspace exists: ${fs.existsSync(workspace)}`);

        const configPath = path.join(workspace, 'config.json');
        debugLog(`DEBUG: Config path: ${configPath}`);
        debugLog(`DEBUG: Config exists: ${fs.existsSync(configPath)}`);

        // Use ConfigManager for consistent path resolution
        try {
          const tempConfigManager = new ConfigManager(configPath);
          await tempConfigManager.loadConfig();
          const promptsConfigPath = tempConfigManager.getPromptsFilePath();
          debugLog(`DEBUG: Prompts config path: ${promptsConfigPath}`);
          debugLog(`DEBUG: Prompts config exists: ${fs.existsSync(promptsConfigPath)}`);
        } catch (tempError) {
          debugLog(`DEBUG: Could not load config for path debugging: ${tempError}`);
        }
      }

      throw error;
    }

    // Get logger reference for global error handling
    if (isVerbose) {
      debugLog('DEBUG: Getting logger reference...');
    }
    const activeOrchestrator = orchestrator;
    const modules = activeOrchestrator.getModules();
    logger = modules.logger;
    const activeLogger = logger;
    if (isVerbose) {
      debugLog('DEBUG: Logger reference obtained');
    }

    // Validate initial startup with detailed diagnostics
    if (isVerbose) {
      debugLog('DEBUG: About to validate application health...');
    }
    const initialHealth = await validateApplicationHealth();
    if (isVerbose) {
      debugLog('DEBUG: Health validation result:', initialHealth);
    }

    if (!initialHealth) {
      // Get detailed health info for debugging
      const healthDetails = activeOrchestrator.validateHealth();
      if (isVerbose) {
        debugLog('DEBUG: Detailed health check results:', JSON.stringify(healthDetails, null, 2));
      }

      throw new Error(
        'Initial health validation failed - application may not be properly initialized. ' +
          'Health details: ' +
          JSON.stringify(healthDetails.issues)
      );
    }

    // If this is a startup test, exit successfully after validation
    if (isStartupTest) {
      if (isVerbose) {
        // Always use stderr to avoid corrupting STDIO protocol
        console.error('✅ MCP Claude Prompts Server startup validation completed successfully');
        console.error(
          '✅ All phases completed: Foundation → Data Loading → Module Initialization → Server Setup'
        );
        console.error('✅ Health validation passed - server is ready for operation');
      }
      await activeOrchestrator.shutdown();
      process.exit(0);
    }

    // Log successful startup with details
    activeLogger.info('🚀 MCP Claude Prompts Server started successfully');

    // Log comprehensive application status
    const status = activeOrchestrator.getStatus();
    activeLogger.info('📊 Application status:', {
      running: status.running,
      transport: status.transport,
      promptsLoaded: status.promptsLoaded,
      categoriesLoaded: status.categoriesLoaded,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      pid: process.pid,
      nodeVersion: process.version,
    });

    // Setup health monitoring
    setupHealthMonitoring(runtimeOptions);

    // Log successful complete initialization
    activeLogger.info('✅ Application initialization completed - all systems operational');
  } catch (error) {
    // Comprehensive error handling with rollback
    console.error('❌ Failed to start MCP Claude Prompts Server:', error);

    if (logger !== null) {
      logger.error('Fatal startup error:', error);
    }

    // Attempt rollback
    await rollbackStartup(error instanceof Error ? error : new Error(String(error)));

    // Exit with error code
    process.exit(1);
  }
}

/**
 * Export health check function for external monitoring
 */
export function getApplicationHealth(): HealthReport & { lastCheck: number } {
  return { ...applicationHealth.report, lastCheck: applicationHealth.lastCheck };
}

/**
 * Export orchestrator diagnostic information for external monitoring
 */
export function getDetailedDiagnostics(): DiagnosticStatus {
  if (orchestrator === null) {
    return {
      available: false,
      reason: 'Orchestrator not initialized',
      timestamp: new Date().toISOString(),
    };
  }

  try {
    const diagnostics = orchestrator.getDiagnosticInfo();
    const { timestamp, ...rest } = diagnostics;
    return {
      ...rest,
      available: true,
      timestamp,
    };
  } catch (error) {
    return {
      available: false,
      reason: `Error collecting diagnostics: ${
        error instanceof Error ? error.message : String(error)
      }`,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Export graceful shutdown for external management
 */
export { gracefulShutdown };

/**
 * Export main startup for opt-in execution (tests/custom runners).
 */
export { main as startServer };

// Start the application with comprehensive error handling
const isTestEnvironment =
  process.env['NODE_ENV'] === 'test' || typeof process.env['JEST_WORKER_ID'] !== 'undefined';

if (!isTestEnvironment) {
  main().catch(async (error) => {
    console.error('💥 Fatal error during startup:', error);

    // Final fallback - attempt rollback and exit
    await rollbackStartup(error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  });
}

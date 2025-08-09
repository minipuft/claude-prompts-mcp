/**
 * MCP Claude Prompts Server - Main Entry Point
 * Minimal entry point with comprehensive error handling, health checks, and validation
 */

import { Logger } from "./logging/index.js";
import { startApplication } from "./orchestration/index.js";

/**
 * Health check and validation state
 */
interface ApplicationHealth {
  startup: boolean;
  modules: boolean;
  server: boolean;
  lastCheck: number;
}

/**
 * Application state for health monitoring and rollback
 */
let applicationHealth: ApplicationHealth = {
  startup: false,
  modules: false,
  server: false,
  lastCheck: Date.now(),
};

let orchestrator: any = null;
let logger: Logger | null = null;
let isShuttingDown = false;

/**
 * Validate application health
 */
async function validateApplicationHealth(): Promise<boolean> {
  try {
    if (!orchestrator) {
      return false;
    }

    // Use the orchestrator's comprehensive health validation
    const healthCheck = orchestrator.validateHealth();

    // Update health state with detailed information
    applicationHealth = {
      startup: healthCheck.modules.foundation,
      modules: healthCheck.modules.modulesInitialized,
      server: healthCheck.modules.serverRunning,
      lastCheck: Date.now(),
    };

    // Log health issues if any
    if (!healthCheck.healthy && logger && healthCheck.issues.length > 0) {
      logger.warn("Health validation found issues:", healthCheck.issues);
    }

    return healthCheck.healthy;
  } catch (error) {
    if (logger) {
      logger.error("Health validation failed:", error);
    }
    return false;
  }
}

/**
 * Rollback mechanism for startup failures
 */
async function rollbackStartup(error: Error): Promise<void> {
  // Use stderr for error output to avoid interfering with stdio transport
  console.error("Critical startup failure, attempting rollback:", error);

  try {
    if (orchestrator) {
      console.error(
        "Attempting graceful shutdown of partial initialization..."
      );
      await orchestrator.shutdown();
      orchestrator = null;
    }

    // Reset health state
    applicationHealth = {
      startup: false,
      modules: false,
      server: false,
      lastCheck: Date.now(),
    };

    console.error("Rollback completed");
  } catch (rollbackError) {
    console.error("Error during rollback:", rollbackError);
  }
}

/**
 * Setup periodic health checks
 */
function setupHealthMonitoring(): void {
  if (!logger) return;

  // Health check every 30 seconds
  setInterval(async () => {
    if (isShuttingDown || !logger) return;

    try {
      const isHealthy = await validateApplicationHealth();
      if (!isHealthy) {
        logger.warn("Health check failed - application may be degraded");

        // Log current status for debugging
        if (orchestrator) {
          const diagnostics = orchestrator.getDiagnosticInfo();
          logger.warn("Diagnostic information:", {
            health: diagnostics.health,
            performance: diagnostics.performance,
            errors: diagnostics.errors,
          });
        }
      } else {
        // Periodic performance logging (every 5th health check = 2.5 minutes)
        if (Date.now() % (5 * 30000) < 30000) {
          const performance = orchestrator.getPerformanceMetrics();
          logger.info("Performance metrics:", {
            uptime: `${Math.floor(performance.uptime / 60)} minutes`,
            memoryUsage: `${Math.round(
              performance.memoryUsage.heapUsed / 1024 / 1024
            )}MB`,
            prompts: performance.application.promptsLoaded,
            categories: performance.application.categoriesLoaded,
          });
        }
      }
    } catch (error) {
      logger.error("Error during health check:", error);

      // Emergency diagnostic collection
      try {
        const emergency = getDetailedDiagnostics();
        logger.error("Emergency diagnostics:", emergency);
      } catch (diagError) {
        logger.error("Failed to collect emergency diagnostics:", diagError);
      }
    }
  }, 30000);

  logger.info(
    "Health monitoring enabled (30-second intervals with performance tracking)"
  );
}

/**
 * Setup comprehensive error handlers
 */
function setupErrorHandlers(): void {
  // Handle uncaught exceptions with rollback
  process.on("uncaughtException", async (error) => {
    console.error("Uncaught exception detected:", error);

    if (logger) {
      logger.error(
        "Uncaught exception - initiating emergency shutdown:",
        error
      );
    }

    isShuttingDown = true;

    try {
      if (orchestrator) {
        await orchestrator.shutdown();
      }
    } catch (shutdownError) {
      console.error("Error during emergency shutdown:", shutdownError);
    }

    process.exit(1);
  });

  // Handle unhandled promise rejections with rollback
  process.on("unhandledRejection", async (reason, promise) => {
    console.error(
      "Unhandled promise rejection at:",
      promise,
      "reason:",
      reason
    );

    if (logger) {
      logger.error(
        "Unhandled promise rejection - initiating emergency shutdown:",
        { reason, promise }
      );
    }

    isShuttingDown = true;

    try {
      if (orchestrator) {
        await orchestrator.shutdown();
      }
    } catch (shutdownError) {
      console.error("Error during emergency shutdown:", shutdownError);
    }

    process.exit(1);
  });

  // Handle SIGINT (Ctrl+C) gracefully
  process.on("SIGINT", async () => {
    if (logger) {
      logger.info("Received SIGINT (Ctrl+C), initiating graceful shutdown...");
    } else {
      console.error(
        "Received SIGINT (Ctrl+C), initiating graceful shutdown..."
      );
    }

    await gracefulShutdown(0);
  });

  // Handle SIGTERM gracefully
  process.on("SIGTERM", async () => {
    if (logger) {
      logger.info("Received SIGTERM, initiating graceful shutdown...");
    } else {
      console.error("Received SIGTERM, initiating graceful shutdown...");
    }

    await gracefulShutdown(0);
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
    if (logger) {
      logger.info("Starting graceful shutdown sequence...");
    }

    // Validate current state before shutdown
    if (orchestrator) {
      const status = orchestrator.getStatus();
      if (logger) {
        logger.info("Application status before shutdown:", status);
      }

      // Perform graceful shutdown
      await orchestrator.shutdown();

      if (logger) {
        logger.info("Orchestrator shutdown completed successfully");
      }
    }

    // Final health state update
    applicationHealth = {
      startup: false,
      modules: false,
      server: false,
      lastCheck: Date.now(),
    };

    if (logger) {
      logger.info("Graceful shutdown completed successfully");
    } else {
      console.error("Graceful shutdown completed successfully");
    }
  } catch (error) {
    if (logger) {
      logger.error("Error during graceful shutdown:", error);
    } else {
      console.error("Error during graceful shutdown:", error);
    }
    exitCode = 1;
  }

  process.exit(exitCode);
}

/**
 * Display help information
 */
function showHelp(): void {
  console.log(`
MCP Claude Prompts Server v1.1.0 - Enhanced Execution & Gate Validation

USAGE:
  node dist/index.js [OPTIONS]

OPTIONS:
  --transport=TYPE     Transport type: stdio (default) or sse
  --quiet             Minimal output mode (production-friendly)
  --verbose           Detailed diagnostics and strategy information
  --debug-startup     Alias for --verbose with extra debugging
  --startup-test      Validate startup and exit (for testing)
  --help              Show this help message

ENVIRONMENT VARIABLES:
  MCP_SERVER_ROOT              Override server root directory detection (recommended)
  MCP_PROMPTS_CONFIG_PATH      Direct path to prompts configuration file

OPTIMIZED STARTUP MODES:
  Production:    node dist/index.js --quiet --transport=stdio
  Development:   node dist/index.js --verbose --transport=sse
  Debugging:     node dist/index.js --debug-startup
  Silent:        node dist/index.js --quiet

EXAMPLES:
  # Standard usage
  node dist/index.js

  # Claude Desktop (recommended configuration)
  node dist/index.js --transport=stdio --quiet

  # Development with detailed logging
  node dist/index.js --verbose --transport=sse

  # With environment override (fastest startup)
  MCP_SERVER_ROOT=/path/to/server node dist/index.js --quiet

PERFORMANCE FEATURES:
  ✓ Optimized strategy ordering (fastest detection first)
  ✓ Early termination on first success
  ✓ Environment variable bypass for instant detection
  ✓ Conditional logging based on verbosity level
  ✓ Intelligent fallback with user guidance

TROUBLESHOOTING:
  Use --verbose to see detailed server root detection strategies
  Set MCP_SERVER_ROOT environment variable for instant path detection
  Use --quiet in production for clean startup logs

For more information, visit: https://github.com/minipuft/claude-prompts-mcp
`);
}

/**
 * Parse and validate command line arguments
 */
function parseCommandLineArgs(): { shouldExit: boolean; exitCode: number } {
  const args = process.argv.slice(2);

  // Check for help flag
  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
    return { shouldExit: true, exitCode: 0 };
  }

  // Validate transport argument
  const transportArg = args.find((arg) => arg.startsWith("--transport="));
  if (transportArg) {
    const transport = transportArg.split("=")[1];
    if (!["stdio", "sse"].includes(transport)) {
      console.error(
        `Error: Invalid transport '${transport}'. Supported: stdio, sse`
      );
      console.error("Use --help for usage information");
      return { shouldExit: true, exitCode: 1 };
    }
  }

  // Validate that conflicting flags aren't used together
  const isQuiet = args.includes("--quiet");
  const isVerbose =
    args.includes("--verbose") || args.includes("--debug-startup");

  if (isQuiet && isVerbose) {
    console.error("Error: Cannot use --quiet and --verbose flags together");
    console.error("Use --help for usage information");
    return { shouldExit: true, exitCode: 1 };
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
    const args = process.argv.slice(2);
    const isStartupTest = args.includes('--startup-test');
    if (isStartupTest) {
      console.error("DEBUG: Running in startup validation mode");
      console.error(`DEBUG: Platform: ${process.platform}`);
      console.error(`DEBUG: Node.js version: ${process.version}`);
      console.error(`DEBUG: Working directory: ${process.cwd()}`);
      console.error(`DEBUG: MCP_SERVER_ROOT: ${process.env.MCP_SERVER_ROOT || 'not set'}`);
      console.error(`DEBUG: MCP_PROMPTS_CONFIG_PATH: ${process.env.MCP_PROMPTS_CONFIG_PATH || 'not set'}`);
    }

    // Setup error handlers first
    setupErrorHandlers();

    // Use stderr for startup message to avoid interfering with stdio transport
    console.error("Starting MCP Claude Prompts Server...");

    // Initialize the application using the orchestrator
    console.error("DEBUG: About to call startApplication()...");
    try {
      orchestrator = await startApplication();
      console.error("DEBUG: startApplication() completed successfully");
    } catch (startupError) {
      const error = startupError instanceof Error ? startupError : new Error(String(startupError));
      console.error("DEBUG: startApplication() failed with error:", error.message);
      console.error("DEBUG: Error stack:", error.stack);
      
      // Additional diagnostics for Windows
      if (process.platform === 'win32') {
        console.error("DEBUG: Windows-specific diagnostics:");
        console.error(`DEBUG: Process argv: ${JSON.stringify(process.argv)}`);
        console.error(`DEBUG: Environment keys: ${Object.keys(process.env).filter(k => k.startsWith('MCP_')).join(', ')}`);
        
        // Check if paths exist
        const fs = await import('fs');
        const path = await import('path');
        
        const serverRoot = process.env.MCP_SERVER_ROOT || process.cwd();
        console.error(`DEBUG: Checking server root: ${serverRoot}`);
        console.error(`DEBUG: Server root exists: ${fs.existsSync(serverRoot)}`);
        
        const configPath = path.join(serverRoot, 'config.json');
        console.error(`DEBUG: Config path: ${configPath}`);
        console.error(`DEBUG: Config exists: ${fs.existsSync(configPath)}`);
        
        const promptsConfigPath = path.join(serverRoot, 'promptsConfig.json');
        console.error(`DEBUG: Prompts config path: ${promptsConfigPath}`);
        console.error(`DEBUG: Prompts config exists: ${fs.existsSync(promptsConfigPath)}`);
      }
      
      throw error;
    }

    // Get logger reference for global error handling
    console.error("DEBUG: Getting logger reference...");
    const modules = orchestrator.getModules();
    logger = modules.logger;
    console.error("DEBUG: Logger reference obtained");

    // Validate initial startup with detailed diagnostics
    console.error("DEBUG: About to validate application health...");
    const initialHealth = await validateApplicationHealth();
    console.error("DEBUG: Health validation result:", initialHealth);
    
    if (!initialHealth) {
      // Get detailed health info for debugging
      const healthDetails = orchestrator.validateHealth();
      console.error("DEBUG: Detailed health check results:", JSON.stringify(healthDetails, null, 2));
      
      throw new Error(
        "Initial health validation failed - application may not be properly initialized. " +
        "Health details: " + JSON.stringify(healthDetails.issues)
      );
    }

    // If this is a startup test, exit successfully after validation
    if (isStartupTest) {
      console.error("✅ MCP Claude Prompts Server startup validation completed successfully");
      console.error("✅ All phases completed: Foundation → Data Loading → Module Initialization → Server Setup");
      console.error("✅ Health validation passed - server is ready for operation");
      await orchestrator.shutdown();
      process.exit(0);
    }

    // Log successful startup with details
    if (logger) {
      logger.info("🚀 MCP Claude Prompts Server started successfully");

      // Log comprehensive application status
      const status = orchestrator.getStatus();
      logger.info("📊 Application status:", {
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
      setupHealthMonitoring();

      // Log successful complete initialization
      logger.info(
        "✅ Application initialization completed - all systems operational"
      );
    }
  } catch (error) {
    // Comprehensive error handling with rollback
    console.error("❌ Failed to start MCP Claude Prompts Server:", error);

    if (logger) {
      logger.error("Fatal startup error:", error);
    }

    // Attempt rollback
    await rollbackStartup(
      error instanceof Error ? error : new Error(String(error))
    );

    // Exit with error code
    process.exit(1);
  }
}

/**
 * Export health check function for external monitoring
 */
export function getApplicationHealth(): ApplicationHealth {
  return { ...applicationHealth };
}

/**
 * Export orchestrator diagnostic information for external monitoring
 */
export function getDetailedDiagnostics(): any {
  if (!orchestrator) {
    return {
      available: false,
      reason: "Orchestrator not initialized",
      timestamp: new Date().toISOString(),
    };
  }

  try {
    return {
      available: true,
      timestamp: new Date().toISOString(),
      ...orchestrator.getDiagnosticInfo(),
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

// Start the application with comprehensive error handling
main().catch(async (error) => {
  console.error("💥 Fatal error during startup:", error);

  // Final fallback - attempt rollback and exit
  await rollbackStartup(
    error instanceof Error ? error : new Error(String(error))
  );
  process.exit(1);
});

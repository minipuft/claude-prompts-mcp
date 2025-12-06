#!/usr/bin/env node
/**
 * MCP Server Supervisor
 * Transparent proxy that keeps MCP client connections alive during server restarts
 *
 * Inspired by reloaderoo - provides seamless hot-reloading for MCP servers
 */
import { spawn } from 'child_process';
import { createSimpleLogger } from '../logging/index.js';
import { createRestartPolicyManager } from './restart-policy.js';
import { createStdioProxy } from './stdio-proxy.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
/**
 * Default supervisor configuration
 */
const DEFAULT_SUPERVISOR_CONFIG = {
    enabled: true,
    childCommand: 'node',
    childArgs: ['dist/index.js'],
    restartTimeout: 30000,
    maxRestarts: 3,
    restartDelay: 1000,
    backoffMultiplier: 1.5,
    logLevel: 'info'
};
/**
 * Supervisor class
 * Manages child server process lifecycle and maintains client connections
 */
export class Supervisor {
    constructor(config = {}) {
        this.isRunning = false;
        this.startTime = 0;
        this.isShuttingDown = false;
        this.config = { ...DEFAULT_SUPERVISOR_CONFIG, ...config };
        // Initialize logger (using simple logger for supervisor)
        this.logger = createSimpleLogger('stdio');
        // Initialize restart policy manager
        this.restartPolicy = createRestartPolicyManager(this.logger, {
            maxRestarts: this.config.maxRestarts,
            restartDelay: this.config.restartDelay,
            restartTimeout: this.config.restartTimeout,
            backoffMultiplier: this.config.backoffMultiplier
        });
        // Initialize STDIO proxy
        this.stdioProxy = createStdioProxy(this.logger);
    }
    /**
     * Start supervisor and spawn initial child process
     */
    async start() {
        if (this.isRunning) {
            this.logger.warn('Supervisor already running');
            return;
        }
        this.logger.info('🔄 Starting MCP Server Supervisor...');
        this.logger.info(`Command: ${this.config.childCommand} ${this.config.childArgs?.join(' ')}`);
        this.logger.info(`Max restarts: ${this.config.maxRestarts}, Restart delay: ${this.config.restartDelay}ms`);
        this.startTime = Date.now();
        this.isRunning = true;
        // Setup signal handlers for graceful shutdown
        this.setupSignalHandlers();
        // Spawn initial child process
        await this.spawnChild('Initial startup');
        this.emitEvent({
            type: 'supervisor_started',
            timestamp: Date.now(),
            message: 'Supervisor started successfully'
        });
    }
    /**
     * Spawn child server process
     */
    async spawnChild(reason) {
        const startTime = Date.now();
        this.logger.info(`🚀 Spawning child process - Reason: ${reason}`);
        try {
            // Parse command and arguments
            const command = this.config.childCommand;
            const args = this.config.childArgs || [];
            // Spawn child process with supervised environment
            this.childProcess = spawn(command, args, {
                env: {
                    ...process.env,
                    SUPERVISED_BY_RELOADER: 'true',
                    SUPERVISOR_RESTART_COUNT: String(this.restartPolicy.getCount())
                },
                stdio: ['pipe', 'pipe', 'inherit'], // stdin/stdout piped, stderr inherited
                cwd: process.cwd()
            });
            if (!this.childProcess.pid) {
                throw new Error('Failed to spawn child process - no PID assigned');
            }
            this.logger.info(`✅ Child process spawned - PID: ${this.childProcess.pid}`);
            // Setup STDIO proxy
            this.stdioProxy.setupProxy(this.childProcess);
            // Setup child process event handlers
            this.setupChildHandlers();
            const latency = Date.now() - startTime;
            this.logger.info(`Child spawn latency: ${latency}ms`);
            this.emitEvent({
                type: 'child_spawned',
                timestamp: Date.now(),
                message: `Child process spawned (PID: ${this.childProcess.pid})`,
                metadata: { pid: this.childProcess.pid, latency, reason }
            });
        }
        catch (error) {
            this.logger.error('Failed to spawn child process:', error);
            throw error;
        }
    }
    /**
     * Setup child process event handlers
     */
    setupChildHandlers() {
        if (!this.childProcess)
            return;
        // Handle child process exit
        this.childProcess.on('exit', (code, signal) => {
            this.handleChildExit(code, signal);
        });
        // Handle child process errors
        this.childProcess.on('error', (error) => {
            this.logger.error('Child process error:', error);
        });
    }
    /**
     * Handle child process exit
     */
    async handleChildExit(code, signal) {
        // Teardown STDIO proxy
        if (this.childProcess) {
            this.stdioProxy.teardown(this.childProcess);
        }
        const exitCode = code !== null ? code : -1;
        // Don't attempt restart if supervisor is shutting down
        if (this.isShuttingDown) {
            this.logger.info('Supervisor shutting down - not restarting child');
            return;
        }
        if (exitCode === 0) {
            // Clean exit - restart requested
            await this.handleRestartRequest();
        }
        else {
            // Error exit - crash
            await this.handleCrash(exitCode, signal);
        }
    }
    /**
     * Handle clean restart request (exit code 0)
     */
    async handleRestartRequest() {
        const startTime = Date.now();
        this.logger.info('🔄 Clean restart requested by child process');
        this.emitEvent({
            type: 'child_restarted',
            timestamp: Date.now(),
            message: 'Child process requested restart',
            exitCode: 0,
            reason: 'Clean restart request'
        });
        // Apply restart delay
        const delay = this.restartPolicy.getRestartDelay();
        if (delay > 0) {
            this.logger.debug(`Applying restart delay: ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        // Spawn new child
        await this.spawnChild('Clean restart request');
        // Record restart
        const latency = Date.now() - startTime;
        this.restartPolicy.recordRestart(true, latency);
        this.logger.info(`✅ Clean restart completed in ${latency}ms`);
    }
    /**
     * Handle child process crash (exit code > 0)
     */
    async handleCrash(exitCode, signal) {
        this.logger.error(`❌ Child process crashed - Exit code: ${exitCode}, Signal: ${signal}`);
        this.emitEvent({
            type: 'child_crashed',
            timestamp: Date.now(),
            message: `Child process crashed (exit code: ${exitCode})`,
            exitCode,
            signal: signal || undefined
        });
        // Check if restart is allowed
        if (!this.restartPolicy.shouldRestart(exitCode)) {
            if (this.restartPolicy.isCrashLooping()) {
                this.logger.error('🔴 CRASH LOOP DETECTED - Supervisor stopping');
                this.emitEvent({
                    type: 'crash_loop_detected',
                    timestamp: Date.now(),
                    message: 'Crash loop detected - supervisor stopping'
                });
            }
            else {
                this.logger.error('🔴 MAX RESTARTS EXCEEDED - Supervisor stopping');
                this.emitEvent({
                    type: 'max_restarts_exceeded',
                    timestamp: Date.now(),
                    message: 'Maximum restart attempts exceeded - supervisor stopping'
                });
            }
            await this.stop();
            process.exit(1);
            return;
        }
        // Apply exponential backoff
        const startTime = Date.now();
        const delay = this.restartPolicy.getRestartDelay();
        this.logger.warn(`Applying exponential backoff: ${delay}ms before restart`);
        await new Promise(resolve => setTimeout(resolve, delay));
        // Spawn new child
        await this.spawnChild(`Crash recovery (exit code: ${exitCode})`);
        // Record crash restart
        const latency = Date.now() - startTime;
        this.restartPolicy.recordRestart(false, latency);
        this.logger.info(`Child restarted after crash in ${latency}ms`);
    }
    /**
     * Setup signal handlers for graceful shutdown
     */
    setupSignalHandlers() {
        const signals = ['SIGINT', 'SIGTERM'];
        for (const signal of signals) {
            process.on(signal, async () => {
                this.logger.info(`Received ${signal} - initiating graceful shutdown`);
                await this.stop();
                process.exit(0);
            });
        }
    }
    /**
     * Stop supervisor and terminate child gracefully
     */
    async stop() {
        if (!this.isRunning) {
            return;
        }
        this.isShuttingDown = true;
        this.logger.info('🛑 Stopping supervisor...');
        if (this.childProcess) {
            await this.terminateChild(this.config.restartTimeout);
        }
        this.isRunning = false;
        this.logger.info('✅ Supervisor stopped');
        this.emitEvent({
            type: 'supervisor_stopped',
            timestamp: Date.now(),
            message: 'Supervisor stopped successfully'
        });
    }
    /**
     * Terminate child process gracefully with timeout
     */
    async terminateChild(timeout) {
        if (!this.childProcess)
            return;
        this.logger.info(`Sending SIGTERM to child process (PID: ${this.childProcess.pid})`);
        // Send SIGTERM for graceful shutdown
        this.childProcess.kill('SIGTERM');
        this.emitEvent({
            type: 'graceful_shutdown',
            timestamp: Date.now(),
            message: `SIGTERM sent to child process (PID: ${this.childProcess.pid})`
        });
        // Wait for graceful shutdown
        const shutdownPromise = new Promise((resolve) => {
            this.childProcess.once('exit', () => {
                this.logger.info('Child process exited gracefully');
                resolve();
            });
        });
        // Timeout promise
        const timeoutPromise = new Promise((resolve) => {
            this.shutdownTimeout = setTimeout(() => {
                this.logger.warn(`Graceful shutdown timeout (${timeout}ms) - sending SIGKILL`);
                if (this.childProcess) {
                    this.childProcess.kill('SIGKILL');
                    this.emitEvent({
                        type: 'forced_shutdown',
                        timestamp: Date.now(),
                        message: 'SIGKILL sent after graceful shutdown timeout'
                    });
                }
                resolve();
            }, timeout);
        });
        // Wait for either graceful shutdown or timeout
        await Promise.race([shutdownPromise, timeoutPromise]);
        // Clear timeout if graceful shutdown succeeded
        if (this.shutdownTimeout) {
            clearTimeout(this.shutdownTimeout);
            this.shutdownTimeout = undefined;
        }
    }
    /**
     * Get supervisor status
     */
    getStatus() {
        return {
            running: this.isRunning,
            childPid: this.childProcess?.pid,
            startTime: this.startTime,
            uptime: Date.now() - this.startTime,
            restartStats: this.restartPolicy.getStats(),
            crashLooping: this.restartPolicy.isCrashLooping()
        };
    }
    /**
     * Emit supervisor event (for logging and monitoring)
     */
    emitEvent(event) {
        this.logger.debug('Supervisor event:', event);
    }
}
/**
 * Load supervisor configuration from file
 */
async function loadSupervisorConfig(configPath) {
    if (!configPath) {
        // Try to find config file
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const serverRoot = path.resolve(__dirname, '../../..');
        const defaultConfigPath = path.join(serverRoot, 'server/config.json');
        try {
            const configContent = await readFile(defaultConfigPath, 'utf8');
            const config = JSON.parse(configContent);
            return config.supervisor || {};
        }
        catch (error) {
            // Config file not found or invalid - use defaults
            return {};
        }
    }
    try {
        const configContent = await readFile(configPath, 'utf8');
        const config = JSON.parse(configContent);
        return config.supervisor || {};
    }
    catch (error) {
        console.error(`Failed to load config from ${configPath}:`, error);
        return {};
    }
}
/**
 * Main entry point (when run directly)
 */
async function main() {
    // Parse command line arguments
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
  Claude Prompts MCP - Supervisor Mode

  Usage: npm run supervisor [options]

  Options:
    --help, -h          Show this help message
    --config <path>     Path to config file (default: server/config/server/config.json)
    --log-level <level> Logging level (debug|info|warn|error)

  Environment Variables:
    MCP_SERVER_ROOT            Override server root directory
    MCP_PROMPTS_CONFIG_PATH    Override prompts config path
    SUPERVISED_BY_RELOADER     Set by supervisor (do not set manually)

  Examples:
    npm run supervisor                           # Start with default config
    npm run supervisor --log-level debug         # Start with debug logging

  For more information, see: docs/supervisor-integration.md
  `);
        process.exit(0);
    }
    // Parse config path
    const configIndex = args.indexOf('--config');
    const configPath = configIndex >= 0 ? args[configIndex + 1] : undefined;
    // Parse log level
    const logLevelIndex = args.indexOf('--log-level');
    const logLevel = logLevelIndex >= 0 ? args[logLevelIndex + 1] : undefined;
    // Load configuration
    const config = await loadSupervisorConfig(configPath);
    // Override log level if specified
    if (logLevel) {
        config.logLevel = logLevel;
    }
    // Create and start supervisor
    const supervisor = new Supervisor(config);
    try {
        await supervisor.start();
    }
    catch (error) {
        console.error('Failed to start supervisor:', error);
        process.exit(1);
    }
}
// Run main if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}
// Export for programmatic usage
export { DEFAULT_SUPERVISOR_CONFIG };
//# sourceMappingURL=index.js.map
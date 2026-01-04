/**
 * STDIO Proxy
 * Transparent bidirectional message forwarding between MCP client and child server
 */
/**
 * StdioProxy class
 * Handles transparent STDIO proxying for MCP protocol messages
 */
export class StdioProxy {
    constructor(logger) {
        this.isProxying = false;
        // Message statistics (for debugging and monitoring)
        this.messagesClientToChild = 0;
        this.messagesChildToClient = 0;
        this.logger = logger;
    }
    /**
     * Setup STDIO proxy between client and child process
     */
    setupProxy(childProcess) {
        if (this.isProxying) {
            this.logger.warn('STDIO proxy already active');
            return;
        }
        if (!childProcess.stdin || !childProcess.stdout) {
            throw new Error('Child process must have stdin/stdout pipes');
        }
        // Client → Child (transparent forwarding)
        process.stdin.pipe(childProcess.stdin);
        // Child → Client (transparent forwarding)
        childProcess.stdout.pipe(process.stdout);
        this.isProxying = true;
        this.logger.info('✅ STDIO proxy established');
        this.logger.debug('Transparent bidirectional message forwarding active (Client ↔ Supervisor ↔ Child)');
        // Optional: Monitor message flow for debugging (enable via DEBUG env var)
        if (process.env.DEBUG === 'true' || process.argv.includes('--log-level=debug')) {
            this.setupMessageMonitoring(childProcess);
        }
    }
    /**
     * Setup message monitoring for debugging (optional)
     */
    setupMessageMonitoring(childProcess) {
        // Monitor stdin flow (Client → Child)
        process.stdin.on('data', (chunk) => {
            this.messagesClientToChild++;
            this.logger.debug(`📥 Client → Child: ${chunk.length} bytes (total messages: ${this.messagesClientToChild})`);
        });
        // Monitor stdout flow (Child → Client)
        if (childProcess.stdout) {
            childProcess.stdout.on('data', (chunk) => {
                this.messagesChildToClient++;
                this.logger.debug(`📤 Child → Client: ${chunk.length} bytes (total messages: ${this.messagesChildToClient})`);
            });
        }
    }
    /**
     * Teardown STDIO proxy
     */
    teardown(childProcess) {
        if (!this.isProxying) {
            return;
        }
        try {
            // Unpipe streams
            if (childProcess.stdin) {
                process.stdin.unpipe(childProcess.stdin);
            }
            if (childProcess.stdout) {
                childProcess.stdout.unpipe(process.stdout);
            }
            this.isProxying = false;
            this.logger.info(`STDIO proxy teardown complete - Forwarded ${this.messagesClientToChild} client messages, ${this.messagesChildToClient} child messages`);
        }
        catch (error) {
            this.logger.error('Error during STDIO proxy teardown:', error);
        }
    }
    /**
     * Check if proxy is active
     */
    isActive() {
        return this.isProxying;
    }
    /**
     * Get message statistics
     */
    getStats() {
        return {
            clientToChild: this.messagesClientToChild,
            childToClient: this.messagesChildToClient,
            total: this.messagesClientToChild + this.messagesChildToClient
        };
    }
    /**
     * Reset message statistics
     */
    resetStats() {
        this.messagesClientToChild = 0;
        this.messagesChildToClient = 0;
        this.logger.debug('STDIO proxy statistics reset');
    }
}
/**
 * Factory function to create an STDIO proxy
 */
export function createStdioProxy(logger) {
    return new StdioProxy(logger);
}
//# sourceMappingURL=stdio-proxy.js.map
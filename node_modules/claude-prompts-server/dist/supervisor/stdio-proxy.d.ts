/**
 * STDIO Proxy
 * Transparent bidirectional message forwarding between MCP client and child server
 */
import { ChildProcess } from 'child_process';
import { Logger } from '../logging/index.js';
/**
 * StdioProxy class
 * Handles transparent STDIO proxying for MCP protocol messages
 */
export declare class StdioProxy {
    private logger;
    private isProxying;
    private messagesClientToChild;
    private messagesChildToClient;
    constructor(logger: Logger);
    /**
     * Setup STDIO proxy between client and child process
     */
    setupProxy(childProcess: ChildProcess): void;
    /**
     * Setup message monitoring for debugging (optional)
     */
    private setupMessageMonitoring;
    /**
     * Teardown STDIO proxy
     */
    teardown(childProcess: ChildProcess): void;
    /**
     * Check if proxy is active
     */
    isActive(): boolean;
    /**
     * Get message statistics
     */
    getStats(): {
        clientToChild: number;
        childToClient: number;
        total: number;
    };
    /**
     * Reset message statistics
     */
    resetStats(): void;
}
/**
 * Factory function to create an STDIO proxy
 */
export declare function createStdioProxy(logger: Logger): StdioProxy;

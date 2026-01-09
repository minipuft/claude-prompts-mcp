#!/usr/bin/env node
/**
 * MCP Claude Prompts Server - Main Entry Point
 * Minimal entry point with comprehensive error handling, health checks, and validation
 */
import type { Application } from './runtime/application.js';
import type { HealthReport } from './runtime/health.js';
type DiagnosticStatus = ({
    available: true;
    timestamp: string;
} & ReturnType<Application['getDiagnosticInfo']>) | {
    available: false;
    reason: string;
    timestamp: string;
};
/**
 * Graceful shutdown with validation
 */
declare function gracefulShutdown(exitCode?: number): Promise<void>;
/**
 * Main application entry point with comprehensive error handling and validation
 */
declare function main(): Promise<void>;
/**
 * Export health check function for external monitoring
 */
export declare function getApplicationHealth(): HealthReport & {
    lastCheck: number;
};
/**
 * Export orchestrator diagnostic information for external monitoring
 */
export declare function getDetailedDiagnostics(): DiagnosticStatus;
/**
 * Export graceful shutdown for external management
 */
export { gracefulShutdown };
/**
 * Export main startup for opt-in execution (tests/custom runners).
 */
export { main as startServer };

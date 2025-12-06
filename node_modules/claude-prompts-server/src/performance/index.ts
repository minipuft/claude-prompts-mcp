// @lifecycle canonical - Barrel exports for performance monitoring.
/**
 * Performance Monitoring Module
 *
 * Exports performance monitoring and optimization functionality
 * for the MCP server system.
 */

export {
  PerformanceMonitor,
  createPerformanceMonitor,
  type PerformanceMetrics,
  type PerformanceThresholds,
  type PerformanceAlert,
} from './monitor.js';

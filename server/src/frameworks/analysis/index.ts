/**
 * Framework Analysis
 * Semantic analysis and enhancement pipeline components
 */

// Legacy enhanced-semantic-analyzer has been replaced by unified semantic-analyzer
// Export from the new location
export type { SemanticAnalysis } from '../../analysis/semantic-analyzer.js';
export { SemanticAnalyzer, createSemanticAnalyzer } from '../../analysis/semantic-analyzer.js';
export * from './framework-enhancement-pipeline.js';
export * from './framework-consensus-engine.js';
/**
 * Supervisor Configuration Management
 * Handles loading and validation of supervisor-specific configuration
 */
import { SupervisorConfig } from '../supervisor/types.js';
/**
 * Default supervisor configuration
 * Supervisor is disabled by default for backward compatibility
 */
export declare const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig;
/**
 * Load supervisor configuration from main config object
 */
export declare function loadSupervisorConfig(config: any): SupervisorConfig;
/**
 * Validate supervisor configuration
 * Throws error if configuration is invalid
 */
export declare function validateSupervisorConfig(config: SupervisorConfig): void;
/**
 * Get supervisor configuration with validation
 */
export declare function getSupervisorConfig(config: any): SupervisorConfig;

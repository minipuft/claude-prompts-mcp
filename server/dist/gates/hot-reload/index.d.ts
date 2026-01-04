/**
 * Gate Hot Reload Module
 *
 * Provides hot reload coordination for gate definitions,
 * enabling seamless updates when YAML files change.
 */
export { GateHotReloadCoordinator, createGateHotReloadCoordinator, createGateHotReloadRegistration, type GateHotReloadEvent, type GateHotReloadConfig, type GateHotReloadStats, type GateHotReloadRegistration, } from './gate-hot-reload.js';

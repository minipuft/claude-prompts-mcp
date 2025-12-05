// @lifecycle canonical - Loads gate definitions from disk with hot reload support.
/**
 * Gate Loader - Loads gate definitions from YAML/JSON files
 * Provides hot-reloading capabilities similar to prompt system
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'url';

import { Logger } from '../../logging/index.js';
import { ResourceLoader } from '../../utils/resource-loader.js';
import { validateLightweightGateDefinition } from '../utils/gate-definition-schema.js';

import type { LightweightGateDefinition, GateActivationResult } from '../types.js';
import type { TemporaryGateRegistry } from './temporary-gate-registry.js';

/**
 * Gate loader with caching and hot-reload support
 */
export class GateLoader {
  private gateCache = new Map<string, LightweightGateDefinition>();
  private lastModified = new Map<string, number>();
  private logger: Logger;
  private gatesDirectory: string;
  private temporaryGateRegistry?: TemporaryGateRegistry;
  private resourceLoader: ResourceLoader;

  constructor(
    logger: Logger,
    gatesDirectory?: string,
    temporaryGateRegistry?: TemporaryGateRegistry
  ) {
    this.logger = logger;

    // If gatesDirectory not provided, try to resolve from import.meta.url
    if (gatesDirectory !== undefined) {
      this.gatesDirectory = gatesDirectory;
    } else {
      // Try import.meta.url resolution (works in production ES modules)
      try {
        const __filename = fileURLToPath(eval('import.meta.url') as string);
        const __dirname = path.dirname(__filename);
        this.gatesDirectory = path.join(__dirname, '../../gates/definitions');
      } catch (error) {
        // Fallback for Jest/test environments where import.meta is unavailable
        // Use process.cwd() as fallback
        this.gatesDirectory = path.join(process.cwd(), 'src/gates/definitions');
        this.logger.debug('[GateLoader] Using fallback gates directory:', this.gatesDirectory);
      }
    }

    this.temporaryGateRegistry = temporaryGateRegistry;
    this.resourceLoader = new ResourceLoader({ logger: this.logger });
  }

  setTemporaryGateRegistry(temporaryGateRegistry?: TemporaryGateRegistry): void {
    this.temporaryGateRegistry = temporaryGateRegistry;
  }

  /**
   * Load a gate definition by ID with caching
   */
  async loadGate(gateId: string): Promise<LightweightGateDefinition | null> {
    try {
      const tempGate = this.temporaryGateRegistry?.getTemporaryGate(gateId);
      if (tempGate !== undefined) {
        const lightweight = this.temporaryGateRegistry?.convertToLightweightGate(tempGate);
        if (lightweight) {
          this.gateCache.set(gateId, lightweight);
          return lightweight;
        }
      }

      const gateFile = await this.findGateFile(gateId);
      if (gateFile === null) {
        this.logger.warn(`Gate definition not found: ${gateId}`);
        return null;
      }

      const cachedGate = this.gateCache.get(gateId);
      const loadResult = await this.parseGateFile(gateFile);

      if (loadResult === null) {
        return null;
      }

      if (loadResult.gate.id !== gateId) {
        this.logger.error(
          `Gate ID mismatch in file ${gateFile}: expected ${gateId}, got ${loadResult.gate.id}`
        );
        return null;
      }

      // Preserve existing cached instance if nothing changed for consistency
      if (cachedGate !== undefined && loadResult.fromCache === true && loadResult.mtime !== undefined) {
        this.logger.debug(`Using cached gate definition: ${gateId}`);
        return cachedGate;
      }

      this.gateCache.set(gateId, loadResult.gate);

      if (loadResult.mtime !== undefined) {
        this.lastModified.set(gateId, loadResult.mtime);
      }

      this.logger.debug(`Gate loaded successfully: ${gateId}`);
      return loadResult.gate;
    } catch (error) {
      this.logger.error(`Failed to load gate ${gateId}:`, error);
      return null;
    }
  }

  /**
   * Load multiple gates by IDs
   */
  async loadGates(gateIds: string[]): Promise<LightweightGateDefinition[]> {
    const gates: LightweightGateDefinition[] = [];

    for (const gateId of gateIds) {
      const gate = await this.loadGate(gateId);
      if (gate !== null) {
        gates.push(gate);
      }
    }

    return gates;
  }

  /**
   * Get active gates based on context and criteria
   */
  async getActiveGates(
    gateIds: string[],
    context: {
      promptCategory?: string;
      framework?: string;
      explicitRequest?: boolean;
    }
  ): Promise<GateActivationResult> {
    const allGates = await this.loadGates(gateIds);
    const activeGates: LightweightGateDefinition[] = [];
    const guidanceText: string[] = [];
    const validationGates: LightweightGateDefinition[] = [];

    for (const gate of allGates) {
      if (this.isGateActive(gate, context)) {
        activeGates.push(gate);

        // Collect guidance text
        if (gate.guidance !== undefined && gate.guidance !== '') {
          guidanceText.push(`**${gate.name}:**\n${gate.guidance}`);
        }

        // Collect validation gates
        if (gate.type === 'validation') {
          validationGates.push(gate);
        }
      }
    }

    return {
      activeGates,
      guidanceText,
      validationGates,
    };
  }

  /**
   * List all available gate IDs
   */
  async listAvailableGates(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.gatesDirectory);
      const gateFiles = files.filter(
        (file) => file.endsWith('.yaml') || file.endsWith('.yml') || file.endsWith('.json')
      );

      return gateFiles.map((file) => path.basename(file, path.extname(file)));
    } catch (error) {
      this.logger.error('Failed to list available gates:', error);
      return [];
    }
  }

  /**
   * List all available gate definitions (full objects)
   * Used by JudgeSelectionStage to build resource menu for LLM selection.
   */
  async listAvailableGateDefinitions(): Promise<LightweightGateDefinition[]> {
    try {
      const gateIds = await this.listAvailableGates();
      const gates: LightweightGateDefinition[] = [];

      for (const gateId of gateIds) {
        const gate = await this.loadGate(gateId);
        if (gate !== null) {
          gates.push(gate);
        }
      }

      return gates;
    } catch (error) {
      this.logger.error('Failed to list available gate definitions:', error);
      return [];
    }
  }

  /**
   * Clear gate cache (for hot-reloading)
   */
  clearCache(gateId?: string): void {
    if (gateId !== undefined) {
      this.gateCache.delete(gateId);
      this.lastModified.delete(gateId);
      this.logger.debug(`Cleared cache for gate: ${gateId}`);
    } else {
      this.gateCache.clear();
      this.lastModified.clear();
      this.logger.debug('Cleared all gate cache');
    }
  }

  /**
   * Find the gate file for a given ID
   */
  private async findGateFile(gateId: string): Promise<string | null> {
    const extensions = ['.yaml', '.yml', '.json'];

    for (const ext of extensions) {
      const filePath = path.join(this.gatesDirectory, `${gateId}${ext}`);
      try {
        await fs.access(filePath);
        return filePath;
      } catch {
        // File doesn't exist, try next extension
      }
    }

    return null;
  }

  /**
   * Parse a gate file (YAML or JSON)
   */
  private async parseGateFile(filePath: string): Promise<{
    gate: LightweightGateDefinition;
    mtime?: number;
    fromCache?: boolean;
  } | null> {
    try {
      const result = await this.resourceLoader.load<unknown>(filePath, {
        kind: 'auto',
        useCache: true,
      });

      if (result.success !== true) {
        this.logger.error(`Failed to load gate file ${filePath}: ${result.error ?? 'unknown error'}`);
        return null;
      }

      const validation = validateLightweightGateDefinition(result.data);

      if (validation.success !== true || validation.data === undefined) {
        this.logger.error(
          `Invalid gate definition in ${filePath}: ${validation.errors?.join('; ')}`
        );
        return null;
      }

      return {
        gate: validation.data,
        mtime: result.mtimeMs,
        fromCache: result.fromCache,
      };
    } catch (error) {
      this.logger.error(`Failed to parse gate file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Check if a gate should be activated based on context
   */
  /**
   * Determine if a gate should be active for the provided context.
   * Exposed so other systems (e.g., guidance rendering) can reuse the
   * canonical activation logic instead of duplicating it.
   */
  public isGateActive(
    gate: LightweightGateDefinition,
    context: {
      promptCategory?: string;
      framework?: string;
      explicitRequest?: boolean;
    }
  ): boolean {
    const activation = gate.activation;
    if (activation === undefined) {
      // No activation rules means always active
      return true;
    }

    // Check explicit request
    if (activation.explicit_request === true && context.explicitRequest !== true) {
      return false;
    }

    // Check prompt categories (empty array means no restriction)
    if ((activation.prompt_categories?.length ?? 0) > 0 && context.promptCategory !== undefined) {
      if (activation.prompt_categories?.includes(context.promptCategory) === false) {
        return false;
      }
    }

    // Check framework context (empty array means no restriction)
    // Case-insensitive comparison to handle CAGEERF vs cageerf mismatches
    if ((activation.framework_context?.length ?? 0) > 0 && context.framework !== undefined) {
      const normalizedFramework = context.framework.toUpperCase();
      const normalizedContexts = activation.framework_context?.map((f) => f.toUpperCase()) ?? [];
      if (!normalizedContexts.includes(normalizedFramework)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get gate statistics
   */
  getStatistics(): {
    cachedGates: number;
    totalLoads: number;
    lastAccess: Date | null;
  } {
    return {
      cachedGates: this.gateCache.size,
      totalLoads: this.lastModified.size,
      lastAccess: this.lastModified.size > 0 ? new Date() : null,
    };
  }

  /**
   * Check if a gate is a methodology/framework gate by loading and inspecting its definition.
   * Framework gates have gate_type === 'framework' and are filtered when methodology gates are disabled.
   *
   * @param gateId - Gate identifier to check
   * @returns true if gate has gate_type === 'framework', false otherwise
   */
  async isMethodologyGate(gateId: string): Promise<boolean> {
    const gate = await this.loadGate(gateId);
    return gate?.gate_type === 'framework';
  }

  /**
   * Check if a gate ID is a methodology gate using cached data only (synchronous).
   * Returns false if gate is not in cache - use isMethodologyGate for definitive check.
   *
   * @param gateId - Gate identifier to check
   * @returns true if cached gate has gate_type === 'framework', false otherwise
   */
  isMethodologyGateCached(gateId: string): boolean {
    const cached = this.gateCache.get(gateId) ?? this.gateCache.get(gateId.toLowerCase());
    return cached?.gate_type === 'framework';
  }

  /**
   * Get all methodology gate IDs from loaded definitions.
   * Scans the definitions directory and returns IDs of gates with gate_type === 'framework'.
   *
   * @returns Array of methodology gate IDs
   */
  async getMethodologyGateIds(): Promise<string[]> {
    const allGates = await this.listAvailableGateDefinitions();
    return allGates.filter((gate) => gate.gate_type === 'framework').map((gate) => gate.id);
  }
}

/**
 * Create a gate loader instance
 */
export function createGateLoader(
  logger: Logger,
  gatesDirectory?: string,
  temporaryGateRegistry?: TemporaryGateRegistry
): GateLoader {
  return new GateLoader(logger, gatesDirectory, temporaryGateRegistry);
}

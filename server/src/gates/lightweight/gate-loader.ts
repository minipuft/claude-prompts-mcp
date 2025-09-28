/**
 * Gate Loader - Loads gate definitions from YAML/JSON files
 * Provides hot-reloading capabilities similar to prompt system
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from '../../logging/index.js';
import type { LightweightGateDefinition, GateActivationResult } from './types.js';

/**
 * Gate loader with caching and hot-reload support
 */
export class GateLoader {
  private gateCache = new Map<string, LightweightGateDefinition>();
  private lastModified = new Map<string, number>();
  private logger: Logger;
  private gatesDirectory: string;

  constructor(logger: Logger, gatesDirectory?: string) {
    this.logger = logger;
    // Use import.meta.url to get current directory in ES modules
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    this.gatesDirectory = gatesDirectory || path.join(__dirname, '../../gates/definitions');
  }

  /**
   * Load a gate definition by ID with caching
   */
  async loadGate(gateId: string): Promise<LightweightGateDefinition | null> {
    try {
      const gateFile = await this.findGateFile(gateId);
      if (!gateFile) {
        this.logger.warn(`Gate definition not found: ${gateId}`);
        return null;
      }

      // Check if we need to reload
      const stat = await fs.stat(gateFile);
      const lastMod = this.lastModified.get(gateId);

      if (!this.gateCache.has(gateId) || !lastMod || stat.mtimeMs > lastMod) {
        this.logger.debug(`Loading gate definition: ${gateId}`);
        const gate = await this.parseGateFile(gateFile);

        if (gate && gate.id === gateId) {
          this.gateCache.set(gateId, gate);
          this.lastModified.set(gateId, stat.mtimeMs);
          this.logger.debug(`Gate loaded successfully: ${gateId}`);
        } else {
          this.logger.error(`Gate ID mismatch in file ${gateFile}: expected ${gateId}, got ${gate?.id}`);
          return null;
        }
      }

      return this.gateCache.get(gateId) || null;
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
      if (gate) {
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
      if (this.shouldActivateGate(gate, context)) {
        activeGates.push(gate);

        // Collect guidance text
        if (gate.guidance) {
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
      validationGates
    };
  }

  /**
   * List all available gates
   */
  async listAvailableGates(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.gatesDirectory);
      const gateFiles = files.filter(file =>
        file.endsWith('.yaml') || file.endsWith('.yml') || file.endsWith('.json')
      );

      return gateFiles.map(file => path.basename(file, path.extname(file)));
    } catch (error) {
      this.logger.error('Failed to list available gates:', error);
      return [];
    }
  }

  /**
   * Clear gate cache (for hot-reloading)
   */
  clearCache(gateId?: string): void {
    if (gateId) {
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
  private async parseGateFile(filePath: string): Promise<LightweightGateDefinition | null> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const ext = path.extname(filePath);

      let parsed: any;
      if (ext === '.json') {
        parsed = JSON.parse(content);
      } else {
        // For YAML support, we'd need to add js-yaml dependency
        // For now, support JSON only to avoid new dependencies
        throw new Error(`YAML support not implemented. Convert ${filePath} to JSON.`);
      }

      // Basic validation
      if (!parsed.id || !parsed.name || !parsed.type) {
        throw new Error(`Invalid gate definition in ${filePath}: missing required fields`);
      }

      return parsed as LightweightGateDefinition;
    } catch (error) {
      this.logger.error(`Failed to parse gate file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Check if a gate should be activated based on context
   */
  private shouldActivateGate(
    gate: LightweightGateDefinition,
    context: {
      promptCategory?: string;
      framework?: string;
      explicitRequest?: boolean;
    }
  ): boolean {
    const activation = gate.activation;
    if (!activation) {
      // No activation rules means always active
      return true;
    }

    // Check explicit request
    if (activation.explicit_request && !context.explicitRequest) {
      return false;
    }

    // Check prompt categories
    if (activation.prompt_categories && context.promptCategory) {
      if (!activation.prompt_categories.includes(context.promptCategory)) {
        return false;
      }
    }

    // Check framework context
    if (activation.framework_context && context.framework) {
      if (!activation.framework_context.includes(context.framework)) {
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
      lastAccess: this.lastModified.size > 0 ? new Date() : null
    };
  }
}

/**
 * Create a gate loader instance
 */
export function createGateLoader(logger: Logger, gatesDirectory?: string): GateLoader {
  return new GateLoader(logger, gatesDirectory);
}
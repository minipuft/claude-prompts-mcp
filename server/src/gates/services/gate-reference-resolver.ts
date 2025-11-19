// @lifecycle canonical - Resolves gate references to concrete service implementations.
import { METHODOLOGY_GATES } from '../constants.js';

import type { GateLoader } from '../core/gate-loader.js';

export type GateReferenceResolution =
  | {
      referenceType: 'registered';
      gateId: string;
    }
  | {
      referenceType: 'inline';
      criteria: string;
    };

/**
 * Resolves inline gate references by checking whether they match
 * canonical gate definitions or should remain inline criteria.
 */
export class GateReferenceResolver {
  private readonly cache = new Map<string, GateReferenceResolution>();

  constructor(private readonly gateLoader: GateLoader) {}

  async resolve(reference: string): Promise<GateReferenceResolution> {
    const normalized = reference?.trim();
    if (!normalized) {
      return { referenceType: 'inline', criteria: '' };
    }

    const cached = this.cache.get(normalized);
    if (cached) {
      return cached;
    }

    const resolution = await this.computeResolution(normalized);
    this.cache.set(normalized, resolution);
    return resolution;
  }

  private async computeResolution(value: string): Promise<GateReferenceResolution> {
    if (this.isGateSlug(value)) {
      const candidateIds = this.buildCandidates(value);
      for (const candidate of candidateIds) {
        const gate = await this.gateLoader.loadGate(candidate);
        if (gate) {
          return {
            referenceType: 'registered',
            gateId: gate.id,
          };
        }
      }

      const normalized = value.toLowerCase();
      if (METHODOLOGY_GATES.has(normalized)) {
        return {
          referenceType: 'registered',
          gateId: normalized,
        };
      }
    }

    return {
      referenceType: 'inline',
      criteria: value,
    };
  }

  private isGateSlug(value: string): boolean {
    return /^[A-Za-z0-9_-]+$/.test(value);
  }

  private buildCandidates(value: string): string[] {
    const lowerCase = value.toLowerCase();
    if (value === lowerCase) {
      return [value];
    }

    return [value, lowerCase];
  }
}

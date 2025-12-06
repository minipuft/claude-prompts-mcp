// @lifecycle canonical - Registers framework definitions and exposes availability metadata.
import { Logger } from '../../logging/index.js';

import type {
  FrameworkDefinition,
  FrameworkSelectionCriteria,
  FrameworkRegistryMetadata,
} from '../types/methodology-types.js';

export interface FrameworkRegistryOptions {
  defaultFrameworkId?: string;
}

export class FrameworkRegistry {
  private readonly frameworks = new Map<string, FrameworkDefinition>();
  private readonly enabledFrameworks = new Set<string>();
  private readonly frameworkMetadata = new Map<string, FrameworkRegistryMetadata>();
  private defaultFrameworkId?: string;

  constructor(
    private readonly logger: Logger,
    options: FrameworkRegistryOptions = {}
  ) {
    this.defaultFrameworkId = options.defaultFrameworkId;
  }

  loadDefinitions(definitions: FrameworkDefinition[]): void {
    this.frameworks.clear();
    this.enabledFrameworks.clear();
    this.frameworkMetadata.clear();

    for (const definition of definitions) {
      this.registerDefinition(definition);
    }

    if (this.defaultFrameworkId && !this.frameworks.has(this.defaultFrameworkId)) {
      this.logger.warn(
        `Configured default framework '${this.defaultFrameworkId}' not found; default disabled`
      );
      this.defaultFrameworkId = undefined;
    }
  }

  registerDefinition(
    definition: FrameworkDefinition,
    metadata?: Partial<FrameworkRegistryMetadata>
  ): void {
    const normalizedId = definition.id.toUpperCase();
    const normalized: FrameworkDefinition = {
      ...definition,
      id: normalizedId,
      // Ensure computed methodology property is always present
      get methodology() {
        return this.id.toLowerCase();
      },
    } as FrameworkDefinition;

    // Create or update metadata
    const registryMetadata: FrameworkRegistryMetadata = {
      registeredAt: new Date(),
      isBuiltIn: metadata?.isBuiltIn ?? false,
      loadTime: metadata?.loadTime ?? 0,
      validationStatus: metadata?.validationStatus ?? 'not_validated',
      lastUsed: metadata?.lastUsed,
    };

    this.frameworks.set(normalizedId, normalized);
    this.frameworkMetadata.set(normalizedId, registryMetadata);
    if (normalized.enabled) {
      this.enabledFrameworks.add(normalizedId);
    }
  }

  getFramework(id: string): FrameworkDefinition | undefined {
    const normalized = id.toUpperCase();
    const framework = this.frameworks.get(normalized);
    if (framework) {
      // Attach metadata to the framework definition
      const metadata = this.frameworkMetadata.get(normalized);
      if (metadata) {
        // Update last used timestamp
        metadata.lastUsed = new Date();
        return {
          ...framework,
          registryMetadata: { ...metadata },
          // Computed property for backward compatibility
          get methodology() {
            return this.id.toLowerCase();
          },
        } as FrameworkDefinition;
      }
    }
    return framework;
  }

  listFrameworks(enabledOnly = true): FrameworkDefinition[] {
    const frameworks = Array.from(this.frameworks.values());
    const filtered = enabledOnly ? frameworks.filter((framework) => framework.enabled) : frameworks;

    // Attach metadata to each framework and add computed methodology property
    return filtered.map((framework) => {
      const metadata = this.frameworkMetadata.get(framework.id);
      return metadata
        ? ({
            ...framework,
            registryMetadata: { ...metadata },
            // Computed property for backward compatibility
            get methodology() {
              return this.id.toLowerCase();
            },
          } as FrameworkDefinition)
        : framework;
    });
  }

  isFrameworkEnabled(id: string): boolean {
    return this.enabledFrameworks.has(id.toUpperCase());
  }

  validateFrameworkId(id: string): boolean {
    return this.frameworks.has(id.toUpperCase());
  }

  /**
   * Check if a framework exists in the registry (alias for validateFrameworkId)
   * @param id - Framework ID (case-insensitive)
   * @returns true if framework exists, false otherwise
   */
  hasFramework(id: string): boolean {
    return this.validateFrameworkId(id);
  }

  /**
   * Validate framework identifier and return normalized ID or error details
   * @param id - Framework ID to validate
   * @returns Validation result with normalized ID or error message
   */
  validateIdentifier(id: string): {
    valid: boolean;
    normalizedId?: string;
    error?: string;
    suggestions?: string[];
  } {
    const normalizedId = id.toUpperCase();

    if (this.frameworks.has(normalizedId)) {
      return {
        valid: true,
        normalizedId,
      };
    }

    // Generate helpful error message with available frameworks
    const availableFrameworks = Array.from(this.frameworks.keys());
    return {
      valid: false,
      error: `Framework '${id}' not found`,
      suggestions: availableFrameworks,
    };
  }

  /**
   * Get all registered framework IDs (normalized to uppercase)
   * @param enabledOnly - Only return enabled frameworks
   * @returns Array of framework IDs
   */
  getFrameworkIds(enabledOnly = false): string[] {
    const frameworks = this.listFrameworks(enabledOnly);
    return frameworks.map((f) => f.id);
  }

  selectFramework(criteria: FrameworkSelectionCriteria): FrameworkDefinition | undefined {
    const preference = criteria.userPreference?.toUpperCase();
    if (preference && this.isFrameworkEnabled(preference)) {
      return this.frameworks.get(preference);
    }

    if (this.defaultFrameworkId && this.enabledFrameworks.has(this.defaultFrameworkId)) {
      return this.frameworks.get(this.defaultFrameworkId);
    }

    return undefined;
  }
}

/**
 * Get list of all available framework IDs from the methodology registry.
 * This is the single source of truth for valid framework identifiers.
 *
 * All IDs are normalized to uppercase for case-insensitive matching.
 *
 * @returns Array of valid framework IDs in uppercase (e.g., ['CAGEERF', 'REACT', 'WH', 'SCAMPER'])
 *
 * @example
 * ```typescript
 * const validFrameworks = getAvailableFrameworkIds();
 * const normalizedInput = userInput.toUpperCase();
 * if (!validFrameworks.includes(normalizedInput)) {
 * throw new Error(`Unknown framework. Valid options: ${validFrameworks.join(', ')}`);
 * }
 * ```
 */
export function getAvailableFrameworkIds(): string[] {
  // These framework IDs correspond to the methodology guides in /frameworks/methodology/guides/
  // Each guide implements the IMethodologyGuide interface
  // All IDs are normalized to uppercase for consistent validation
  return ['CAGEERF', 'REACT', 'WH', 'SCAMPER'];
}

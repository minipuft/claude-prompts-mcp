// @lifecycle canonical - Runtime YAML loading for frameworks (replaces build-time compilation)
/**
 * Runtime Framework Loader
 *
 * Loads framework definitions directly from YAML source files at runtime,
 * eliminating the need for build-time YAML→JSON compilation.
 *
 * Features:
 * - Runtime YAML parsing via shared utilities
 * - Automatic inlining of referenced files (phases.yaml, judge-prompt.md)
 * - Validation of definitions on load
 * - Configurable caching for performance
 * - Multi-location directory resolution
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  validateFrameworkSchema,
  validatePhasesSchema,
  type FrameworkSchemaValidationResult,
} from './framework-schema.js';

import type { FrameworkResourceDefinition } from './framework-definition-types.js';

import { ResourceQuarantine, type QuarantineView } from '#shared/utils/resource-quarantine.js';
import { resourceEntryRoots, resourceLookupOrder } from '#shared/utils/resource-root-lookup.js';
import { loadYamlFileSync, discoverNestedYamlDirectories } from '#shared/utils/yaml/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Configuration for RuntimeFrameworkLoader
 */
export interface RuntimeFrameworkLoaderConfig {
  /** Override default frameworks directory */
  frameworksDir?: string;
  /**
   * Every other contributing framework directory, HIGHEST precedence first.
   *
   * An overlay listed here OUTRANKS `frameworksDir` — see `resourceLookupOrder`. The composition
   * root places `frameworksDir` itself inside this list, at its own rank; a caller configuring the
   * loader by hand may omit it, in which case it is consulted last.
   */
  additionalFrameworksDirs?: string[];
  /** Enable caching of loaded definitions (default: true) */
  enableCache?: boolean;
  /** Validate definitions on load (default: true) */
  validateOnLoad?: boolean;
  /** Log debug information */
  debug?: boolean;
}

/**
 * Statistics from the loader
 */
export interface LoaderStats {
  /** Number of cached definitions */
  cacheSize: number;
  /** Cache hit count */
  cacheHits: number;
  /** Cache miss count */
  cacheMisses: number;
  /** Number of load errors encountered */
  loadErrors: number;
  /** Frameworks directory being used */
  frameworksDir: string;
  /** Additional overlay directories */
  additionalFrameworksDirs: string[];
}

// FrameworkSchemaValidationResult is imported from framework-schema.ts
export type { FrameworkSchemaValidationResult } from './framework-schema.js';

/**
 * Runtime Framework Loader
 *
 * Provides runtime loading of framework definitions from YAML source files,
 * replacing the build-time compilation step.
 *
 * @example
 * ```typescript
 * const loader = new RuntimeFrameworkLoader();
 *
 * // Discover available frameworks
 * const ids = loader.discoverFrameworks();
 * // ['cageerf', 'react', '5w1h', 'scamper']
 *
 * // Load a specific framework
 * const definition = loader.loadFramework('cageerf');
 * ```
 */
export class RuntimeFrameworkLoader {
  private cache = new Map<string, FrameworkResourceDefinition>();
  private stats = { cacheHits: 0, cacheMisses: 0, loadErrors: 0 };
  private frameworksDir: string;
  private additionalFrameworksDirs: string[];
  /** Every root this loader consults for an id, highest precedence first. */
  private readonly lookupDirs: string[];
  private enableCache: boolean;
  private validateOnLoad: boolean;
  private debug: boolean;
  /**
   * Framework files this loader walked, read, and refused. ONE instance for the loader's lifetime,
   * published by reference through {@link getQuarantine} — see the gate loader's twin.
   */
  private readonly quarantine = new ResourceQuarantine();

  constructor(config: RuntimeFrameworkLoaderConfig = {}) {
    this.frameworksDir = config.frameworksDir ?? this.resolveFrameworksDir();
    // From the RAW list — see the gate loader's twin: the primary's rank IS its position here, and
    // filtering it out first would drop it behind the bundled tree.
    this.lookupDirs = resourceLookupOrder(
      this.frameworksDir,
      config.additionalFrameworksDirs ?? []
    );
    // Reported and watched, not looked up.
    this.additionalFrameworksDirs = (config.additionalFrameworksDirs ?? []).filter(
      (dir) => existsSync(dir) && dir !== this.frameworksDir
    );
    this.enableCache = config.enableCache ?? true;
    this.validateOnLoad = config.validateOnLoad ?? true;
    this.debug = config.debug ?? false;

    if (this.debug) {
      // Use stderr to avoid corrupting STDIO protocol
      console.error(`[RuntimeFrameworkLoader] Using directory: ${this.frameworksDir}`);
      if (this.additionalFrameworksDirs.length > 0) {
        console.error(
          `[RuntimeFrameworkLoader] Additional directories: ${this.additionalFrameworksDirs.join(', ')}`
        );
      }
    }
  }

  /**
   * Load a framework definition by ID
   *
   * @param id - Framework ID (e.g., 'cageerf', 'react')
   * @returns Loaded definition or undefined if not found
   */
  loadFramework(id: string): FrameworkResourceDefinition | undefined {
    const normalizedId = id.toLowerCase();

    // Check cache first
    if (this.enableCache && this.cache.has(normalizedId)) {
      this.stats.cacheHits++;
      return this.cache.get(normalizedId);
    }

    this.stats.cacheMisses++;

    const definition = this.loadFromLookupOrder(normalizedId);

    if (!definition) {
      return undefined;
    }

    // Cache result
    if (this.enableCache) {
      this.cache.set(normalizedId, definition);
    }

    return definition;
  }

  /**
   * Discover all available framework IDs
   *
   * @returns Array of framework IDs that have valid entry points
   */
  discoverFrameworks(): string[] {
    // One scan shape for every root — see the gate loader's twin. This answers WHICH ids exist;
    // `loadFramework` answers which root serves each.
    const idSet = new Set<string>();
    for (const dir of this.lookupDirs) {
      for (const id of discoverNestedYamlDirectories(dir, 'framework.yaml')) {
        idSet.add(id.toLowerCase());
      }
    }

    return Array.from(idSet).sort();
  }

  /**
   * Load all available frameworks
   *
   * @returns Map of ID to definition for all successfully loaded frameworks
   */
  loadAllFrameworks(): Map<string, FrameworkResourceDefinition> {
    const results = new Map<string, FrameworkResourceDefinition>();
    const ids = this.discoverFrameworks();

    for (const id of ids) {
      const definition = this.loadFramework(id);
      if (definition) {
        results.set(id, definition);
      }
    }

    return results;
  }

  /**
   * Check if a framework exists
   *
   * @param id - Framework ID to check
   * @returns True if the framework has a valid entry point
   */
  frameworkExists(id: string): boolean {
    return this.entryRootsFor(id.toLowerCase()).length > 0;
  }

  /**
   * Clear the cache (all or specific ID)
   *
   * @param id - Optional specific ID to clear; if omitted, clears all
   */
  clearCache(id?: string): void {
    if (id) {
      this.cache.delete(id.toLowerCase());
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get loader statistics
   */
  getStats(): LoaderStats {
    return {
      cacheSize: this.cache.size,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      loadErrors: this.stats.loadErrors,
      frameworksDir: this.frameworksDir,
      additionalFrameworksDirs: this.additionalFrameworksDirs,
    };
  }

  /**
   * Live view of the framework files that failed to load, across every root read from so far.
   *
   * Never consulted when resolving an id: `loadFramework` reads the catalog side only, so a broken
   * workspace framework leaves the bundled framework of that id serving, exactly as before.
   */
  getQuarantine(): QuarantineView {
    return this.quarantine;
  }

  /**
   * Get the frameworks directory being used
   */
  getFrameworksDir(): string {
    return this.frameworksDir;
  }

  /**
   * Get all directories that should be watched for changes (primary + additional)
   */
  getWatchDirectories(): string[] {
    return [this.frameworksDir, ...this.additionalFrameworksDirs];
  }

  // ============================================================================
  // Private Implementation - Overlay Loading
  // ============================================================================

  /**
   * Load a framework from a specific base directory
   */
  private loadFromDir(id: string, baseDir: string): FrameworkResourceDefinition | undefined {
    const frameworkDir = join(baseDir, id);
    const entryPath = join(frameworkDir, 'framework.yaml');
    const sink = this.quarantine.sinkFor('framework', baseDir);

    /**
     * Refuse this file, and RECORD the refusal.
     *
     * One helper rather than four inline `sink.record(...)` calls, mirroring the gate and prompt
     * loaders: every return below is a framework that vanishes from the registry, and a site that
     * forgets to record is indistinguishable from the `console.error`-and-drop this replaces.
     *
     * Diagnostic text only — never `systemPromptGuidance`, `judgePrompt`, `phases` or any other
     * authored body. A framework's guidance is instruction delivered to the client LLM, and this
     * file is the one whose content has not been validated.
     */
    const refuse = (error: string): undefined => {
      this.stats.loadErrors++;
      sink.record({ id, path: entryPath, error });
      return undefined;
    };

    try {
      if (!existsSync(entryPath)) {
        // NOT a refusal: nothing was walked or read. See the gate loader's twin — recording here
        // would quarantine every id a root simply does not hold.
        if (this.debug) {
          console.error(`[RuntimeFrameworkLoader] Entry point not found: ${entryPath}`);
        }
        return undefined;
      }

      // Load main framework.yaml
      const definition = loadYamlFileSync<FrameworkResourceDefinition>(entryPath, {
        required: true,
      });

      if (!definition) {
        return refuse('framework.yaml is empty or does not parse to a YAML mapping');
      }

      // Inline referenced files
      this.inlineReferencedFiles(definition, frameworkDir);

      const refusal = this.validationRefusal(definition, id);
      if (refusal !== undefined) {
        return refuse(refusal);
      }

      if (this.debug) {
        console.error(`[RuntimeFrameworkLoader] Loaded: ${definition.name} (${id})`);
      }

      // Stamp provenance HERE, where the root is the argument (P4.18, ruling R7) — see the gate
      // loader's twin. Every root reaches this method: the primary from `loadFramework`, each
      // additional one through `loadFromAdditionalDirs`. After validation, so an authored
      // `sourceRoot:` is overwritten rather than believed. For a GROUPED additional directory this
      // is `{dir}/{group}` — the same string this walk's sink stamps on a refusal, which keeps the
      // two sides of a shadow finding comparable.
      definition.sourceRoot = baseDir;

      // The repair side of the record — see the gate loader's twin. This loader is called one id at
      // a time, so a repaired file's record has to be dropped here or it outlives the repair.
      sink.forget(entryPath);
      return definition;
    } catch (error) {
      console.error(`[RuntimeFrameworkLoader] Failed to load '${id}':`, error);
      return refuse(error instanceof Error ? error.message : String(error));
    }
  }

  /** The roots holding this id, highest precedence first. */
  private entryRootsFor(id: string): string[] {
    return resourceEntryRoots(this.lookupDirs, id, 'framework.yaml');
  }

  /**
   * Load from the highest-precedence root that both holds this id AND yields a valid definition.
   *
   * The fall-through on a refusal is the property `getQuarantine`'s docstring states: a broken
   * workspace framework leaves the bundled framework of that id serving. Here it also keeps the
   * server startable — `FrameworkRegistry.loadBuiltInGuides` throws `FATAL` on an id it cannot
   * resolve, so collapsing this to "first root that HAS the file" would let one malformed overlay
   * refuse the boot.
   */
  private loadFromLookupOrder(id: string): FrameworkResourceDefinition | undefined {
    for (const base of this.entryRootsFor(id)) {
      const definition = this.loadFromDir(id, base);
      if (definition !== undefined) return definition;
    }
    return undefined;
  }

  // ============================================================================
  // Private Implementation - Directory Resolution
  // ============================================================================

  /**
   * Resolve the frameworks directory from multiple possible locations
   *
   * Priority:
   *   1. Package.json resolution (npm/npx installs)
   *   3. Walk up from module location (development)
   *   4. Common relative paths (resources/frameworks first, then legacy)
   *   5. Fallback
   */
  private resolveFrameworksDir(): string {
    // Standalone fallback — used when PathResolver is not available (tests, standalone).
    // In production, module-initializer passes the resolved dir via config.

    // 1. Find package.json with our package name (works for npx deep cache paths)
    const pkgResolved = this.resolveFromPackageJson();
    if (pkgResolved) {
      return pkgResolved;
    }

    // 2. Walk up from current module location (fallback for development)
    let current = __dirname;
    for (let i = 0; i < 10; i++) {
      const resourcesCandidate = join(current, 'resources', 'frameworks');
      if (existsSync(resourcesCandidate) && this.hasYamlFiles(resourcesCandidate)) {
        return resourcesCandidate;
      }
      current = dirname(current);
    }

    // Fallback
    return join(__dirname, '..', '..', '..', 'resources', 'frameworks');
  }

  /**
   * Resolve frameworks directory by finding our package.json
   * This handles npx installations where the package is deep in the cache
   */
  private resolveFromPackageJson(): string | null {
    let dir = __dirname;
    for (let i = 0; i < 15; i++) {
      const pkgPath = join(dir, 'package.json');
      try {
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
          if (pkg.name === 'claude-prompts') {
            // Check resources/frameworks first (new structure)
            const resourcesFrameworksPath = join(dir, 'resources', 'frameworks');
            if (existsSync(resourcesFrameworksPath) && this.hasYamlFiles(resourcesFrameworksPath)) {
              return resourcesFrameworksPath;
            }
            // Then check legacy location
            const frameworksPath = join(dir, 'frameworks');
            if (existsSync(frameworksPath) && this.hasYamlFiles(frameworksPath)) {
              return frameworksPath;
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  /**
   * Check if a directory contains YAML framework files
   */
  private hasYamlFiles(dirPath: string): boolean {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      // Check for at least one subdirectory with framework.yaml
      return entries.some((entry) => {
        if (!entry.isDirectory()) return false;
        const entryPath = join(dirPath, entry.name, 'framework.yaml');
        return existsSync(entryPath);
      });
    } catch {
      return false;
    }
  }

  /**
   * Inline referenced files into the definition
   */
  private inlineReferencedFiles(definition: any, frameworkDir: string): void {
    // Inline phases.yaml if referenced
    if (definition.phasesFile) {
      const phasesPath = join(frameworkDir, definition.phasesFile);
      if (existsSync(phasesPath)) {
        try {
          const phases = loadYamlFileSync(phasesPath);
          if (phases) {
            definition.phases = phases;
          }
        } catch (error) {
          console.warn(
            `[RuntimeFrameworkLoader] Failed to inline phases from ${phasesPath}:`,
            error
          );
        }
      }
      delete definition.phasesFile;
    }

    // Inline judge-prompt.md if referenced
    if (definition.judgePromptFile) {
      const judgePath = join(frameworkDir, definition.judgePromptFile);
      if (existsSync(judgePath)) {
        try {
          const content = readFileSync(judgePath, 'utf-8');
          definition.judgePrompt = this.parseJudgePrompt(content);
        } catch (error) {
          console.warn(
            `[RuntimeFrameworkLoader] Failed to inline judge prompt from ${judgePath}:`,
            error
          );
        }
      }
      delete definition.judgePromptFile;
    }
  }

  /**
   * Parse judge prompt markdown into structured format
   */
  private parseJudgePrompt(content: string): {
    systemMessage: string;
    userMessageTemplate: string;
    outputFormat: 'json' | 'structured';
  } {
    // Extract ## System Message section
    const systemMatch = content.match(/## System Message\s*\n([\s\S]*?)(?=\n## |$)/);
    // Extract ## User Message Template section
    const userMatch = content.match(/## User Message Template\s*\n([\s\S]*?)(?=\n## |$)/);

    return {
      systemMessage: systemMatch?.[1]?.trim() ?? '',
      userMessageTemplate: userMatch?.[1]?.trim() ?? '',
      outputFormat: 'json',
    };
  }

  /**
   * The refusal reason for a definition that fails validation, or undefined when it passes.
   *
   * Extracted from `loadFromDir` rather than left inline: validate-then-validate-phases is a
   * decision with its own nesting, and folding it into the walk pushed that method further over
   * the cognitive-complexity limit. Returning the reason rather than recording it keeps the single
   * exit rule intact — this method writes nothing, so `refuse` remains the one place a refusal is
   * recorded. Mirrors `GateDefinitionLoader.validationRefusal`.
   */
  private validationRefusal(
    definition: FrameworkResourceDefinition,
    id: string
  ): string | undefined {
    if (!this.validateOnLoad) return undefined;

    const validation = this.validateDefinition(definition, id);
    if (!validation.valid) {
      console.error(
        `[RuntimeFrameworkLoader] Validation failed for '${id}':`,
        validation.errors.join('; ')
      );
      return validation.errors.join('; ');
    }
    if (validation.warnings.length > 0) {
      console.warn(
        `[RuntimeFrameworkLoader] Warnings for '${id}':`,
        validation.warnings.join('; ')
      );
    }

    // Validate the inlined phases.yaml content (F1: previously dead code — validatePhasesSchema had
    // zero callers, so a guards block with no section_header never reached this check despite
    // existing as an ERROR).
    if (!definition.phases) return undefined;

    const phasesValidation = this.validatePhases(definition.phases);
    if (!phasesValidation.valid) {
      console.error(
        `[RuntimeFrameworkLoader] Phases validation failed for '${id}':`,
        phasesValidation.errors.join('; ')
      );
      // The caller records this against framework.yaml, not phases.yaml: the entry point is what
      // the tool repairs and what `resolveExistingFrameworkDir` locates, and `phasesFile` is a
      // reference the entry point owns. The text still names the phases failure.
      return `phases: ${phasesValidation.errors.join('; ')}`;
    }
    if (phasesValidation.warnings.length > 0) {
      console.warn(
        `[RuntimeFrameworkLoader] Phases warnings for '${id}':`,
        phasesValidation.warnings.join('; ')
      );
    }
    return undefined;
  }

  /**
   * Validate a framework definition using shared Zod schema
   */
  private validateDefinition(
    definition: FrameworkResourceDefinition,
    expectedId: string
  ): FrameworkSchemaValidationResult {
    // Use shared schema validation (SSOT with validate-frameworks.ts)
    return validateFrameworkSchema(definition, expectedId);
  }

  /**
   * Validate the inlined phases.yaml content using the shared Zod schema.
   *
   * Runs the phase-guard coherence checks (guards without section_header,
   * duplicate order, min_length > max_length) that ship in
   * `validatePhasesSchema` but were never wired to a caller (F1).
   */
  private validatePhases(phases: unknown): FrameworkSchemaValidationResult {
    return validatePhasesSchema(phases);
  }
}

/**
 * Factory function with default configuration
 */
export function createRuntimeFrameworkLoader(
  config?: RuntimeFrameworkLoaderConfig
): RuntimeFrameworkLoader {
  return new RuntimeFrameworkLoader(config);
}

// ============================================================================
// Singleton Instance for Convenience
// ============================================================================

let defaultLoader: RuntimeFrameworkLoader | null = null;

/**
 * Get the default runtime framework loader instance
 *
 * Creates a singleton instance on first call.
 */
export function getDefaultRuntimeLoader(
  config?: RuntimeFrameworkLoaderConfig
): RuntimeFrameworkLoader {
  // A caller that SUPPLIES config is the composition root asserting the resolved directories;
  // a caller that omits it is a consumer asking for whatever was established. The old form
  // (`if (!defaultLoader)`) discarded config whenever anything had already touched the singleton,
  // so framework directory resolution silently depended on call order — and the losing branch
  // falls back to `resolveFrameworksDir()`, which finds the package tree.
  //
  // That made reads ignore `MCP_RESOURCES_PATH` exactly as writes did. The two agreed only
  // because both were wrong, which is why it stayed invisible until the write path was fixed
  // (T1.10): correcting one side alone turned a silent mismatch into a failed registration.
  //
  // `module-initializer.ts:219` is the only caller that passes config.
  if (!defaultLoader || config !== undefined) {
    defaultLoader = new RuntimeFrameworkLoader(config);
  }
  return defaultLoader;
}

/**
 * Reset the default loader (for testing)
 */
export function resetDefaultRuntimeLoader(): void {
  defaultLoader = null;
}

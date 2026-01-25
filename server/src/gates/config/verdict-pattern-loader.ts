// @lifecycle canonical - Loads verdict patterns from YAML configuration.
/**
 * Verdict Pattern Loader
 *
 * Loads gate verdict parsing patterns from YAML configuration,
 * enabling runtime customization without code changes.
 *
 * @example
 * ```typescript
 * const patterns = loadVerdictPatterns();
 * for (const { regex, priority } of patterns) {
 *   // Use pattern for verdict parsing
 * }
 * ```
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { loadYamlFileSync } from '../../utils/yaml/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Priority levels for verdict pattern matching.
 * Higher priority patterns are tried first.
 */
export type VerdictPatternPriority = 'primary' | 'high' | 'medium' | 'fallback';

/**
 * A verdict pattern with compiled regex and metadata.
 */
export interface VerdictPattern {
  readonly id: string;
  readonly regex: RegExp;
  readonly priority: VerdictPatternPriority;
  readonly description?: string;
  readonly restrictedSources?: string[];
}

/**
 * Raw pattern definition from YAML.
 */
interface VerdictPatternYaml {
  id: string;
  pattern: string;
  priority: VerdictPatternPriority;
  description?: string;
  restricted_sources?: string[];
  examples?: string[];
}

/**
 * Full YAML configuration structure.
 */
interface VerdictPatternsConfig {
  patterns: VerdictPatternYaml[];
  validation?: {
    require_rationale?: boolean;
    min_rationale_length?: number;
  };
}

// Default patterns as fallback if YAML loading fails
const DEFAULT_PATTERNS: VerdictPattern[] = [
  {
    id: 'full-hyphen',
    regex: /^GATE_REVIEW:\s*(PASS|FAIL)\s*-\s*(.+)$/i,
    priority: 'primary',
    description: 'Full format with hyphen separator',
  },
  {
    id: 'full-colon',
    regex: /^GATE_REVIEW:\s*(PASS|FAIL)\s*:\s*(.+)$/i,
    priority: 'high',
    description: 'Full format with colon separator',
  },
  {
    id: 'simple-hyphen',
    regex: /^GATE\s+(PASS|FAIL)\s*-\s*(.+)$/i,
    priority: 'high',
    description: 'Simplified format with hyphen',
  },
  {
    id: 'simple-colon',
    regex: /^GATE\s+(PASS|FAIL)\s*:\s*(.+)$/i,
    priority: 'medium',
    description: 'Simplified format with colon',
  },
  {
    id: 'minimal',
    regex: /^(PASS|FAIL)\s*[-:]\s*(.+)$/i,
    priority: 'fallback',
    description: 'Minimal format - gate_verdict only',
    restrictedSources: ['gate_verdict'],
  },
];

// Cached patterns (loaded once)
let cachedPatterns: VerdictPattern[] | null = null;
let cachedValidation: { requireRationale: boolean; minRationaleLength: number } | null = null;

/**
 * Resolve the path to the verdict patterns config file.
 */
function resolveConfigPath(): string | null {
  // Try multiple locations
  const candidates = [
    // From src/gates/config/ -> resources/gates/config/
    join(__dirname, '..', '..', '..', 'resources', 'gates', 'config', 'verdict-patterns.yaml'),
    // From dist/gates/config/ -> resources/gates/config/
    join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'resources',
      'gates',
      'config',
      'verdict-patterns.yaml'
    ),
    // Environment variable override
    process.env['MCP_VERDICT_PATTERNS_PATH'],
  ].filter(Boolean) as string[];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}

/**
 * Compile a YAML pattern definition into a VerdictPattern.
 */
function compilePattern(yaml: VerdictPatternYaml): VerdictPattern {
  return {
    id: yaml.id,
    regex: new RegExp(yaml.pattern, 'i'),
    priority: yaml.priority,
    description: yaml.description,
    restrictedSources: yaml.restricted_sources,
  };
}

/**
 * Load verdict patterns from YAML configuration.
 * Falls back to default patterns if loading fails.
 *
 * @param forceReload - If true, bypass cache and reload from file
 * @returns Array of compiled verdict patterns
 */
export function loadVerdictPatterns(forceReload = false): VerdictPattern[] {
  if (cachedPatterns && !forceReload) {
    return cachedPatterns;
  }

  const configPath = resolveConfigPath();

  if (!configPath) {
    console.warn('[VerdictPatternLoader] Config not found, using defaults');
    cachedPatterns = DEFAULT_PATTERNS;
    return cachedPatterns;
  }

  try {
    const config = loadYamlFileSync<VerdictPatternsConfig>(configPath);

    if (!config?.patterns || !Array.isArray(config.patterns)) {
      console.warn('[VerdictPatternLoader] Invalid config structure, using defaults');
      cachedPatterns = DEFAULT_PATTERNS;
      return cachedPatterns;
    }

    cachedPatterns = config.patterns.map(compilePattern);

    // Cache validation settings
    if (config.validation) {
      cachedValidation = {
        requireRationale: config.validation.require_rationale ?? true,
        minRationaleLength: config.validation.min_rationale_length ?? 1,
      };
    }

    return cachedPatterns;
  } catch (error) {
    console.error('[VerdictPatternLoader] Failed to load config:', error);
    cachedPatterns = DEFAULT_PATTERNS;
    return cachedPatterns;
  }
}

/**
 * Get validation settings for verdict parsing.
 */
export function getVerdictValidationSettings(): {
  requireRationale: boolean;
  minRationaleLength: number;
} {
  // Ensure patterns are loaded (which also loads validation)
  loadVerdictPatterns();

  return (
    cachedValidation ?? {
      requireRationale: true,
      minRationaleLength: 1,
    }
  );
}

/**
 * Clear cached patterns (useful for testing or hot reload).
 */
export function clearVerdictPatternCache(): void {
  cachedPatterns = null;
  cachedValidation = null;
}

/**
 * Get patterns by priority level.
 */
export function getPatternsByPriority(priority: VerdictPatternPriority): VerdictPattern[] {
  return loadVerdictPatterns().filter((p) => p.priority === priority);
}

/**
 * Check if a pattern is restricted to specific sources.
 */
export function isPatternRestrictedToSource(pattern: VerdictPattern, source: string): boolean {
  if (!pattern.restrictedSources || pattern.restrictedSources.length === 0) {
    return false; // No restrictions
  }
  return !pattern.restrictedSources.includes(source);
}

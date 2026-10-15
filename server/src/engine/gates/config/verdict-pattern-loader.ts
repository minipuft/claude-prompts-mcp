// @lifecycle canonical - Loads gate verdict validation settings from YAML configuration.
/**
 * Verdict Validation Settings Loader
 *
 * Reads the `validation` block of `verdict-patterns.yaml` (rationale requirements for a
 * structured `gate_verdict`), so an operator can tighten them without a code change.
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { loadYamlFileSync } from '#shared/utils/yaml/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Full YAML configuration structure.
 */
interface VerdictValidationConfig {
  validation?: {
    require_rationale?: boolean;
    min_rationale_length?: number;
  };
}

const DEFAULT_VALIDATION = { requireRationale: true, minRationaleLength: 1 } as const;

// Cached settings (loaded once)
let cachedValidation: { requireRationale: boolean; minRationaleLength: number } | null = null;

/**
 * Resolve the path to the verdict validation config file.
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
 * Get validation settings for verdict parsing, loading them from YAML on first access.
 * Falls back to the defaults when the file is missing, malformed or has no `validation` block.
 */
export function getVerdictValidationSettings(): {
  requireRationale: boolean;
  minRationaleLength: number;
} {
  if (cachedValidation) {
    return cachedValidation;
  }

  const configPath = resolveConfigPath();
  if (!configPath) {
    console.warn('[VerdictValidationLoader] Config not found, using defaults');
    cachedValidation = { ...DEFAULT_VALIDATION };
    return cachedValidation;
  }

  try {
    const config = loadYamlFileSync<VerdictValidationConfig>(configPath);
    cachedValidation = {
      requireRationale:
        config?.validation?.require_rationale ?? DEFAULT_VALIDATION.requireRationale,
      minRationaleLength:
        config?.validation?.min_rationale_length ?? DEFAULT_VALIDATION.minRationaleLength,
    };
  } catch (error) {
    console.error('[VerdictValidationLoader] Failed to load config:', error);
    cachedValidation = { ...DEFAULT_VALIDATION };
  }
  return cachedValidation;
}

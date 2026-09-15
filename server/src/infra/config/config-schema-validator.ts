// @lifecycle canonical - Shared JSON schema validator for server config.
import { readFile } from 'node:fs/promises';

import type { ConfigSchemaValidationResult } from '#shared/types/config-manager.js';
import type { ErrorObject, ValidateFunction } from 'ajv';

// Re-exported (not just imported): infra/config/index.ts imports this type from this module,
// and ConfigSchemaValidationResult's single definition lives in shared/types/config-manager.ts.
export type { ConfigSchemaValidationResult };

type JsonSchema = Record<string, unknown>;

interface CachedValidator {
  validator: ValidateFunction;
  schemaMtimeMs: number;
}

const validatorCache = new Map<string, CachedValidator>();

/**
 * AJV reports an undeclared key as "must NOT have additional properties" and names the key only in
 * `params.additionalProperty`, so the message alone tells a reader which section is wrong but not
 * which key — for a typo, the key is the whole finding.
 */
function undeclaredKeySuffix(error: ErrorObject): string {
  const key: unknown = error.params['additionalProperty'];
  return error.keyword === 'additionalProperties' && typeof key === 'string' ? ` (${key})` : '';
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors || errors.length === 0) {
    return [];
  }

  // Keep the `<path>: <message>` shape: consumers match on the path prefix.
  return errors.map((error) => {
    const dataPath = error.instancePath || '(root)';
    const message = error.message || 'Validation failed';
    return `${dataPath}: ${message}${undeclaredKeySuffix(error)}`;
  });
}

async function getCompiledValidator(schemaPath: string): Promise<ValidateFunction> {
  const stat = await import('node:fs/promises').then((fs) => fs.stat(schemaPath));
  const cached = validatorCache.get(schemaPath);
  if (cached?.schemaMtimeMs === stat.mtimeMs) {
    return cached.validator;
  }

  const schemaContent = await readFile(schemaPath, 'utf8');
  const schema = JSON.parse(schemaContent) as JsonSchema;

  const AjvModule = await import('ajv');
  const AjvCtor = (AjvModule as unknown as { default: new (...args: any[]) => any }).default;
  const ajv = new AjvCtor({
    allErrors: true,
    strict: false,
  });
  const validator = ajv.compile(schema);

  validatorCache.set(schemaPath, {
    validator,
    schemaMtimeMs: stat.mtimeMs,
  });

  return validator;
}

/**
 * Validates `config` against the JSON schema at `schemaPath`. The caller resolves the schema
 * location — `$schema` inside `config` is an editor hint, not a location this function trusts,
 * because a config loaded via MCP_CONFIG_PATH can live anywhere while the schema ships beside the
 * server, and treating `$schema` as authoritative resolves a relative path beside the WRONG file.
 */
export async function validateConfigAgainstSchema(
  config: Record<string, unknown>,
  schemaPath: string
): Promise<ConfigSchemaValidationResult> {
  try {
    const validator = await getCompiledValidator(schemaPath);
    const valid = validator(config);

    if (!valid) {
      return {
        status: 'invalid',
        valid: false,
        errors: formatAjvErrors(validator.errors),
      };
    }

    return {
      status: 'valid',
      valid: true,
      errors: [],
    };
  } catch (error) {
    // The schema itself could not be read, parsed, or compiled — this says nothing about
    // whether `config` is valid, and must never be reported as if it did.
    return {
      status: 'unavailable',
      valid: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

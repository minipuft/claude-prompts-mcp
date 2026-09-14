// @lifecycle canonical - Shared JSON schema validator for server config.
import { readFile } from 'node:fs/promises';

import type { ErrorObject, ValidateFunction } from 'ajv';

type JsonSchema = Record<string, unknown>;

export interface ConfigSchemaValidationResult {
  /** 'valid' = AJV accepted the config. 'invalid' = AJV rejected it. 'unavailable' = the schema
   *  itself could not be read, parsed, or compiled — this is NOT a claim about the config. */
  status: 'valid' | 'invalid' | 'unavailable';
  /** True only when status is 'valid'. Kept alongside `status` so existing reads keep compiling. */
  valid: boolean;
  errors: string[];
}

interface CachedValidator {
  validator: ValidateFunction;
  schemaMtimeMs: number;
}

const validatorCache = new Map<string, CachedValidator>();

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors || errors.length === 0) {
    return [];
  }

  return errors.map((error) => {
    const dataPath = error.instancePath || '(root)';
    const message = error.message || 'Validation failed';
    return `${dataPath}: ${message}`;
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

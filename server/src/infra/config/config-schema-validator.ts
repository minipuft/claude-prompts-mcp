// @lifecycle canonical - Shared JSON schema validator for server config.
import { readFile } from 'node:fs/promises';

import type { ConfigSchemaValidationResult } from '#shared/types/config-manager.js';
import type { ErrorObject, ValidateFunction } from 'ajv';

type JsonSchema = Record<string, unknown>;

interface CachedSchemaEntry {
  validator: ValidateFunction;
  schema: JsonSchema;
  schemaMtimeMs: number;
}

const schemaCache = new Map<string, CachedSchemaEntry>();

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

/**
 * The one read + parse + compile of `schemaPath`, cached by mtime. Both the compiled AJV
 * validator (`getCompiledValidator`) and the parsed schema object (`getParsedConfigSchema`) read
 * from this single entry — there is exactly one cache, keyed on the same mtime check, so a
 * schema edited between calls invalidates both consumers together rather than one at a time.
 */
async function getOrLoadSchemaEntry(schemaPath: string): Promise<CachedSchemaEntry> {
  const stat = await import('node:fs/promises').then((fs) => fs.stat(schemaPath));
  const cached = schemaCache.get(schemaPath);
  if (cached?.schemaMtimeMs === stat.mtimeMs) {
    return cached;
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

  const entry: CachedSchemaEntry = {
    validator,
    schema,
    schemaMtimeMs: stat.mtimeMs,
  };
  schemaCache.set(schemaPath, entry);

  return entry;
}

async function getCompiledValidator(schemaPath: string): Promise<ValidateFunction> {
  const entry = await getOrLoadSchemaEntry(schemaPath);
  return entry.validator;
}

/**
 * The parsed JSON Schema object at `schemaPath`, from the same mtime-keyed cache entry
 * `getCompiledValidator` populates — one read, one parse, one invalidation rule shared by the
 * compiled validator and the raw schema object alike. Callers that only need to walk the schema
 * shape (e.g. `ConfigLoader.listConfigKeys()`, which reads `properties` trees rather than
 * validating data) use this instead of re-reading and re-parsing the file themselves.
 *
 * Propagates read/parse failures by throwing — same as a cold `getCompiledValidator` call — so a
 * missing file or invalid JSON surfaces at the caller rather than being reported as an empty
 * schema.
 */
export async function getParsedConfigSchema(schemaPath: string): Promise<JsonSchema> {
  const entry = await getOrLoadSchemaEntry(schemaPath);
  return entry.schema;
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

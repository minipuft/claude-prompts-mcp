/**
 * The framework YAML gate list must survive a schema parse.
 *
 * FrameworkSchema is `.passthrough()`, so a field the schema does not name is kept on the parsed
 * object but never reaches typed consumers — `definition.frameworkGates` reads as undefined and
 * every downstream check (`?.length`) quietly reports "no gates". No error is raised anywhere,
 * which is why the schema/data split this pins went unnoticed. Parsing the SHIPPED file rather
 * than a hand-built literal is the point: a fixture would drift with the schema instead of
 * catching drift against the data.
 */

import { readFileSync } from 'fs';
import path from 'path';

import { load as loadYaml } from 'js-yaml';

import { FrameworkSchema } from '../../../src/engine/frameworks/definitions/framework-schema.js';

const FRAMEWORK_YAML = path.join(
  process.cwd(),
  'resources',
  'frameworks',
  'cageerf',
  'framework.yaml'
);

describe('framework gate list survives schema parse', () => {
  it('exposes frameworkGates from the shipped cageerf definition', () => {
    const raw = loadYaml(readFileSync(FRAMEWORK_YAML, 'utf8'));

    const parsed = FrameworkSchema.parse(raw) as { frameworkGates?: unknown[] };

    expect(Array.isArray(parsed.frameworkGates)).toBe(true);
    expect(parsed.frameworkGates!.length).toBeGreaterThan(0);
    expect(parsed.frameworkGates![0]).toEqual(
      expect.objectContaining({ id: expect.any(String), validationCriteria: expect.anything() })
    );
  });

  it('still accepts the pre-rename methodologyGates spelling from an older file', () => {
    const raw = loadYaml(readFileSync(FRAMEWORK_YAML, 'utf8')) as Record<string, unknown>;
    const legacy: Record<string, unknown> = { ...raw, methodologyGates: raw.frameworkGates };
    delete legacy.frameworkGates;

    const parsed = FrameworkSchema.parse(legacy) as { frameworkGates?: unknown[] };

    expect(parsed.frameworkGates?.length ?? 0).toBeGreaterThan(0);
  });
});

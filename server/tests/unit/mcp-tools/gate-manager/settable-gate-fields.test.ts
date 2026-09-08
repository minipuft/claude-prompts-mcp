/**
 * P4.4 — `severity` and `enforcementMode` are authorable through the tool.
 *
 * WHY THIS MEASURES THE FILE, NOT A TOOL RESPONSE. The natural home for this proof is the
 * conformance corpus, which drives a real server and asserts on what comes back. It cannot cover
 * these two: no `inspect` path surfaces either field, so the strongest available assertion would
 * be that the call returned ok — which is true of a create that wrote loader defaults. Asserting
 * the YAML is what distinguishes "the parameter was accepted" from "the parameter was written",
 * and those two came apart in this exact subsystem before (a gate created successfully, written
 * durably to disk, and unknown to every read path until restart).
 *
 * The gap is P4.6's: `format: 'json'` is declared, routed, and read by nothing, so there is no
 * lossless projection to assert through. When P4.6 lands, this belongs in the corpus.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { load as parseYaml } from 'js-yaml';

import { GateFileWriter } from '../../../../src/mcp/tools/gate-manager/services/index.js';

import type { ConfigManager, Logger } from '../../../../src/shared/types/index.js';

describe('settable gate fields (P4.4)', () => {
  let workspaceDir: string;
  let gatesDir: string;
  let logger: Logger;
  let configManager: ConfigManager;

  const baseGate = {
    id: 'settable-fields-gate',
    name: 'Settable Fields Gate',
    type: 'validation' as const,
    description: 'proves severity and enforcementMode reach gate.yaml',
    guidance: 'Guidance text',
  };

  const readGateYaml = (): Record<string, unknown> =>
    parseYaml(readFileSync(join(gatesDir, baseGate.id, 'gate.yaml'), 'utf8')) as Record<
      string,
      unknown
    >;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-settable-gate-'));
    gatesDir = join(workspaceDir, 'gates');
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    configManager = {
      getGatesDirectory: () => gatesDir,
      getBundledResourceDirectory: () => undefined,
    } as unknown as ConfigManager;
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('writes a caller-supplied severity and enforcementMode into gate.yaml', async () => {
    const service = new GateFileWriter({ logger, configManager });

    const result = await service.writeGateFiles({
      ...baseGate,
      severity: 'critical',
      enforcementMode: 'blocking',
    });

    expect(result.success).toBe(true);
    const yaml = readGateYaml();
    // `critical` and `blocking` are both NON-DEFAULT: the loader defaults severity to `medium`
    // and derives enforcementMode from severity when absent. Asserting a default value here
    // would pass against a writer that dropped the parameter entirely.
    expect(yaml['severity']).toBe('critical');
    expect(yaml['enforcementMode']).toBe('blocking');
  });

  it('omitting them writes neither key, leaving the loader defaults to apply', async () => {
    const service = new GateFileWriter({ logger, configManager });

    const result = await service.writeGateFiles(baseGate);

    expect(result.success).toBe(true);
    const yaml = readGateYaml();
    // The converse of the test above. Without it, a writer that hardcoded `critical` would pass
    // the first assertion, and settability would be indistinguishable from a new default.
    expect(yaml).not.toHaveProperty('severity');
    expect(yaml).not.toHaveProperty('enforcementMode');
  });

  it('preserves an existing value when a later update omits the field', async () => {
    const service = new GateFileWriter({ logger, configManager });

    await service.writeGateFiles({ ...baseGate, severity: 'critical' });
    // The update path rebuilds gate.yaml from scratch; `PRESERVED_GATE_YAML_KEYS` is what stops
    // that rebuild from silently resetting a value the caller is not touching. Settability must
    // not cost the carry-forward — that is why these two fields are preserved rather than
    // projected keys.
    const result = await service.writeGateFiles({
      ...baseGate,
      description: 'updated, saying nothing about severity',
    });

    expect(result.success).toBe(true);
    expect(readGateYaml()['severity']).toBe('critical');
  });
});

/**
 * One driver per retirement ledger entry: each feeds the retired spelling to the boundary that
 * refuses it (the path resolver, the config loader, the transport router, the gate schema, the
 * `prompt_engine` input schema) and returns the text a user reads. The table iterates the ledger,
 * so an entry added without a driver fails here, and `validate:retirements` (check 2) reads the
 * keys of `DRIVERS` to report the same gap without running Jest.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { validateGateSchema } from '../../../src/engine/gates/core/gate-schema.js';
import { ConfigLoader } from '../../../src/infra/config/index.js';
import { TransportRouter } from '../../../src/infra/http/transport/index.js';
import { buildPromptEngineSchema } from '../../../src/mcp/tools/schemas/prompt-engine.schema.js';
import { PathResolver } from '../../../src/runtime/paths.js';
import { listRetirements } from '../../../src/shared/utils/retirement-notice.js';
import { withResourceLocations } from '../../helpers/resource-locations.js';

/** Returns the refusal text the boundary produced for the retired spelling. */
type Driver = (scratch: string) => Promise<string> | string;

function thrownMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the boundary accepted the retired spelling instead of refusing it');
}

async function rejectedMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('the boundary accepted the retired spelling instead of refusing it');
}

function writeConfig(scratch: string, document: Record<string, unknown>): string {
  const configPath = path.join(scratch, 'config.json');
  writeFileSync(configPath, JSON.stringify(document), 'utf8');
  return configPath;
}

function gateWith(criterion: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'probe',
    name: 'Probe',
    type: 'validation',
    description: 'retirement probe',
    pass_criteria: [criterion],
  };
}

function gateErrors(criterion: Record<string, unknown>): string {
  const result = validateGateSchema(gateWith(criterion), 'probe');
  if (result.valid) throw new Error('the gate schema accepted the retired spelling');
  return result.errors.join('\n');
}

const DRIVERS: Readonly<Record<string, Driver>> = {
  'env-mcp-resources-path': (scratch) => {
    const locations = withResourceLocations();
    try {
      process.env['MCP_RESOURCES_PATH'] = path.join(scratch, 'personal-resources');
      const resolver = new PathResolver({ cli: {}, packageRoot: scratch });
      return thrownMessage(() => resolver.assertUsablePathSettings());
    } finally {
      locations.cleanup();
    }
  },
  'config-prompts-directory': (scratch) => {
    const configPath = writeConfig(scratch, {
      version: 5,
      prompts: { directory: 'custom/prompts' },
    });
    return rejectedMessage(() => new ConfigLoader(configPath).loadConfig());
  },
  'config-analysis-section': async (scratch) => {
    const configPath = writeConfig(scratch, {
      analysis: { semanticAnalysis: { llmIntegration: { enabled: true } } },
    });
    await new ConfigLoader(configPath).loadConfig();
    const notices = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('translated to the 5.0 shape'));
    if (notices.length !== 1)
      throw new Error(`expected one translation notice, saw ${notices.length}`);
    return notices[0] as string;
  },
  'config-server-transport': (scratch) => {
    const configPath = writeConfig(scratch, {
      version: 5,
      server: { transport: 'streamable-http' },
    });
    return rejectedMessage(() => new ConfigLoader(configPath).loadConfig());
  },
  'transport-sse': () => thrownMessage(() => TransportRouter.determineTransport('sse')),
  'gate-shell-command-string': () =>
    gateErrors({ type: 'shell_verify', shell_command: 'npm test' }),
  'gate-criteria-pattern-fields': () =>
    gateErrors({ type: 'shell_verify', shell_command: ['npm', 'test'], required_patterns: ['ok'] }),
  'prompt-engine-gate-verdict-string': () => {
    const result = buildPromptEngineSchema().safeParse({
      command: '>>demo',
      gate_verdict: 'GATE_REVIEW: PASS - looks right',
    });
    if (result.success) throw new Error('prompt_engine accepted a string gate_verdict');
    return result.error.issues.map((issue) => issue.message).join('\n');
  },
};

let warnSpy: jest.SpiedFunction<typeof console.warn>;
let scratch: string;

beforeEach(() => {
  // The config loader's notices reach console.warn; silenced here and read by the drivers.
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  scratch = mkdtempSync(path.join(tmpdir(), 'retirement-refusal-'));
});

afterEach(() => {
  warnSpy.mockRestore();
  rmSync(scratch, { recursive: true, force: true });
});

describe('every retired spelling is refused at its boundary with its ledger text', () => {
  it.each(listRetirements().map((entry) => [entry.id, entry] as const))('%s', async (id, entry) => {
    const driver = DRIVERS[id];
    if (driver === undefined) {
      throw new Error(`retirements.json entry '${id}' has no driver in DRIVERS`);
    }
    const refusal = await driver(scratch);

    expect(refusal).toContain(entry.replacement);
    expect(refusal).toContain(entry.refusedIn);
  });

  it('drives only ids the ledger holds', () => {
    const known = new Set(listRetirements().map((entry) => entry.id));

    expect(Object.keys(DRIVERS).filter((id) => !known.has(id))).toEqual([]);
  });
});

/**
 * One driver per retirement ledger entry: each feeds the retired spelling to the boundary that
 * refuses it (the path resolver, the config loader, the transport router, the gate schema, the
 * `prompt_engine` input schema) and returns the text a user reads. The table iterates the ledger,
 * so an entry added without a driver fails here, and `validate:retirements` (check 2) reads the
 * keys of `DRIVERS` to report the same gap without running Jest.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { UnifiedCommandParser } from '../../../src/engine/execution/parsers/command-parser.js';
import { validateGateSchema } from '../../../src/engine/gates/core/gate-schema.js';
import { ConfigLoader } from '../../../src/infra/config/index.js';
import { TransportRouter } from '../../../src/infra/http/transport/index.js';
import { buildPromptEngineSchema } from '../../../src/mcp/tools/schemas/prompt-engine.schema.js';
import { ScriptToolDefinitionLoader } from '../../../src/modules/automation/core/script-definition-loader.js';
import { runSkillsSyncCommand } from '../../../src/modules/skills-sync/service.js';
import { PathResolver } from '../../../src/runtime/paths.js';
import { listRetirements } from '../../../src/shared/utils/retirement-notice.js';
import { withResourceLocations } from '../../helpers/resource-locations.js';

import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';

/** The config.json shipped before 5.0, byte for byte: `git show 83196fcd:server/config.json`. */
const PRE_5_SHIPPED_CONFIG = new URL(
  '../infra/config/fixtures/pre-5.0-shipped-config.json',
  import.meta.url
);

/** Returns the refusal text the boundary produced for the retired spelling. */
type Driver = (scratch: string) => Promise<string> | string;

/** The `prompt_engine` command parser both transports reach, knowing one framework, `CAGEERF`. */
function commandParser(): UnifiedCommandParser {
  const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never;
  return new UnifiedCommandParser(logger, (normalizedId) => normalizedId === 'CAGEERF');
}

function demoPrompt(): ConvertedPrompt {
  return {
    id: 'demo',
    name: 'demo',
    description: 'retirement probe',
    category: 'general',
    userMessageTemplate: 'body',
    arguments: [],
  };
}

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

/** A workspace whose root holds one prompt, the retired `<workspace>/prompts/<category>/<id>/` layout. */
function workspaceWithRootPrompt(scratch: string): string {
  const workspace = path.join(scratch, 'profile');
  const promptDir = path.join(workspace, 'prompts', 'demo', 'hello');
  mkdirSync(promptDir, { recursive: true });
  writeFileSync(
    path.join(promptDir, 'prompt.yaml'),
    'id: hello\nname: hello\ncategory: demo\ndescription: probe\nuserMessageTemplate: hi\n',
    'utf8'
  );
  return workspace;
}

/**
 * Loads a prompt holding two tools, one carrying `executionYaml` under `execution:` and one
 * written in the current form, through the loader the server uses. Returns the reason the first
 * was refused; throws if it loaded, or if the current-form sibling did not.
 */
function scriptToolRefusal(scratch: string, executionYaml: string): string {
  const promptDir = path.join(scratch, 'prompts', 'demo', 'hello');
  const toolYaml = (id: string, execution: string): string =>
    `id: ${id}\nname: ${id}\nscript: script.py\nruntime: python\nexecution:\n${execution}`;
  for (const [id, execution] of [
    ['retired_probe', executionYaml],
    ['current_probe', '  trigger: explicit\n  confirm: false\n  strict: true\n'],
  ] as const) {
    const toolDir = path.join(promptDir, 'tools', id);
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(path.join(toolDir, 'tool.yaml'), toolYaml(id, execution), 'utf8');
  }

  const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    const report = new ScriptToolDefinitionLoader({
      enableCache: false,
    }).loadAllToolsForPromptDetailed(promptDir, 'hello');
    const refused = report.failures.find((failure) => failure.toolId === 'retired_probe');
    if (refused === undefined) throw new Error('the loader accepted the retired spelling');
    if (report.tools.map((tool) => tool.id).join() !== 'current_probe') {
      throw new Error('the current-form tool next to the refused one did not load');
    }
    return refused.reason;
  } finally {
    stderr.mockRestore();
  }
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
  'config-analysis-section': (scratch) => {
    const configPath = writeConfig(scratch, {
      version: 5,
      analysis: { semanticAnalysis: { llmIntegration: { enabled: true } } },
    });
    return rejectedMessage(() => new ConfigLoader(configPath).loadConfig());
  },
  'config-file-unversioned': async (scratch) => {
    const configPath = path.join(scratch, 'config.json');
    copyFileSync(PRE_5_SHIPPED_CONFIG, configPath);
    const refusal = await rejectedMessage(() => new ConfigLoader(configPath).loadConfig());
    const carried = [
      'frameworks.systemPromptFrequency',
      'advanced.sessions.timeoutMinutes',
      'gates.directory',
      'server.transport',
    ];
    const unnamed = carried.filter((key) => !refusal.includes(`"${key}"`));
    if (unnamed.length > 0) throw new Error(`the refusal does not name ${unnamed.join(', ')}`);
    return refusal;
  },
  'config-server-transport': (scratch) => {
    const configPath = writeConfig(scratch, {
      version: 5,
      server: { transport: 'streamable-http' },
    });
    return rejectedMessage(() => new ConfigLoader(configPath).loadConfig());
  },
  'skills-sync-exports-list': (scratch) => {
    const none = { prompt: [], gate: [], framework: [], style: [] };
    writeFileSync(
      path.join(scratch, 'skills-sync.yaml'),
      'exports:\n  - prompt:examples/alpha\n',
      'utf8'
    );
    return rejectedMessage(() =>
      runSkillsSyncCommand(
        { command: 'export', client: 'claude-code', preview: true },
        { log: () => {}, warn: () => {}, error: () => {} },
        {
          packageRoot: scratch,
          workspace: undefined,
          runtimeStateDir: scratch,
          serverConfigPath: path.join(scratch, 'config.json'),
          sourceRoots: none,
          writeRoots: { prompt: scratch, gate: scratch, framework: scratch, style: scratch },
          bundledRoots: {
            prompt: undefined,
            gate: undefined,
            framework: undefined,
            style: undefined,
          },
        }
      )
    );
  },
  'script-tool-mode': (scratch) => {
    const refusals = ['auto', 'manual', 'confirm'].map((value, index) =>
      scriptToolRefusal(path.join(scratch, `mode-${index}`), `  mode: ${value}\n`)
    );
    if (refusals.some((refusal) => refusal !== refusals[0])) {
      throw new Error('the refusal differs between mode values');
    }
    return refusals[0] as string;
  },
  'script-tool-confidence': (scratch) => scriptToolRefusal(scratch, '  confidence: 0.8\n'),
  'script-tool-trigger-parameter-match': (scratch) =>
    scriptToolRefusal(scratch, '  trigger: parameter_match\n'),
  'transport-sse': () => thrownMessage(() => TransportRouter.determineTransport('sse')),
  'gate-shell-command-string': () =>
    gateErrors({ type: 'shell_verify', shell_command: 'npm test' }),
  'gate-criteria-pattern-fields': () =>
    gateErrors({ type: 'shell_verify', shell_command: ['npm', 'test'], required_patterns: ['ok'] }),
  'folder-layout-workspace-root': (scratch) => {
    const locations = withResourceLocations();
    try {
      const workspace = workspaceWithRootPrompt(scratch);
      const resolver = new PathResolver({ cli: { workspace }, packageRoot: scratch });
      return thrownMessage(() => resolver.assertUsablePathSettings());
    } finally {
      locations.cleanup();
    }
  },
  'prompt-engine-gate-verdict-string': () => {
    const result = buildPromptEngineSchema().safeParse({
      command: '>>demo',
      gate_verdict: 'GATE_REVIEW: PASS - looks right',
    });
    if (result.success) throw new Error('prompt_engine accepted a string gate_verdict');
    return result.error.issues.map((issue) => issue.message).join('\n');
  },
  'command-framework-at-sigil': () =>
    rejectedMessage(() => commandParser().parseCommand('@CAGEERF >>demo', [demoPrompt()])),
  'command-gate-equals-operator': () =>
    rejectedMessage(() => commandParser().parseCommand('>>demo = "cite sources"', [demoPrompt()])),
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

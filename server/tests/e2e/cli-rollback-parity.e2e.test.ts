/**
 * `cpm rollback` and `resource_manager rollback` must produce the same entry file.
 *
 * The CLI has no writer between the snapshot and the file: it merges the recorded snapshot over
 * the YAML. The server hands the same snapshot to the resource's own writer, which translates
 * payload keys into file keys on the way out. Where the two spellings differ, the CLI wrote the
 * payload spelling as a NEW key beside the real one — measured 2026-09-19, before the fix:
 *
 *   - framework: `tool_descriptions:` appeared beside `toolDescriptions:`, and the receipt
 *     reported `toolDescriptions` as "not restored" while writing it under a name nothing reads.
 *   - prompt: `systemMessage:` and `userMessageTemplate:` appeared — the BODIES — beside the
 *     `systemMessageFile:` / `userMessageTemplateFile:` pointers the loader actually reads.
 *   - gate: clean, because its snapshot keys are derived from the writer's own YAML key list.
 *
 * So this file does not assert against a list of known-bad keys, which would only ever catch the
 * three above. It drives both rollback paths over the same version of the same resource and
 * compares the files: any NEW divergence, whatever its spelling, fails here.
 *
 * Both halves are positive controls for each other — each assertion also checks the restore
 * actually happened (`description` back to its v1 value), so a rollback that silently did nothing
 * cannot pass by producing two identically-untouched files.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseYamlOrThrow } from '../../src/shared/utils/yaml/index.js';
import { buildServerEnv } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  startServerWithHttp,
  StreamableHttpMcpClient,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CPM_ENTRY = path.join(SERVER_ROOT, 'dist', 'cpm.js');

interface TypeCase {
  /** `resource_manager` payload that creates the resource with every projected field populated. */
  create: (id: string) => Record<string, unknown>;
  /** The v2 edit, so version 1 is something to roll back TO. */
  update: (id: string) => Record<string, unknown>;
  entryFile: (workspace: string, id: string) => string;
}

const CASES: Record<string, TypeCase> = {
  framework: {
    create: (id) => ({
      resource_type: 'framework',
      action: 'create',
      id,
      name: `Probe ${id}`,
      description: 'V1-DESC',
      system_prompt_guidance: 'V1-GUIDANCE',
      tool_descriptions: { prompt_engine: { description: 'V1 tool description' } },
      phases: [{ id: 'p1', name: 'P1', description: 'only phase' }],
      framework_gates: [
        {
          id: `${id}-gate`,
          name: 'Probe gate',
          description: 'Validates the probe phase',
          frameworkArea: 'p1',
          priority: 'high',
          validationCriteria: ['probe criterion'],
        },
      ],
    }),
    update: (id) => ({ resource_type: 'framework', action: 'update', id, description: 'V2-DESC' }),
    entryFile: (ws, id) => path.join(ws, 'resources', 'frameworks', id, 'framework.yaml'),
  },
  gate: {
    create: (id) => ({
      resource_type: 'gate',
      action: 'create',
      id,
      name: `Probe ${id}`,
      description: 'V1-DESC',
      guidance: 'V1-GUIDANCE',
      type: 'validation',
      severity: 'medium',
    }),
    update: (id) => ({ resource_type: 'gate', action: 'update', id, description: 'V2-DESC' }),
    entryFile: (ws, id) => path.join(ws, 'resources', 'gates', id, 'gate.yaml'),
  },
  prompt: {
    create: (id) => ({
      resource_type: 'prompt',
      action: 'create',
      id,
      category: 'general',
      name: `Probe ${id}`,
      description: 'V1-DESC',
      user_message_template: 'V1-BODY',
      system_message: 'V1-SYS',
    }),
    update: (id) => ({ resource_type: 'prompt', action: 'update', id, description: 'V2-DESC' }),
    entryFile: (ws, id) => path.join(ws, 'resources', 'prompts', 'general', id, 'prompt.yaml'),
  },
};

/**
 * The entry file's key set, minus keys whose value is an empty collection.
 *
 * The one divergence that is NOT a defect: the server's writers omit an empty `arguments` or
 * `chainSteps`, while the CLI's merge writes the snapshot's `[]` explicitly. An absent key and an
 * empty list are the same prompt, so the comparison drops both sides rather than pretending the
 * files are byte-identical — a normalization named here, not hidden in the assertion.
 */
function comparableKeys(yamlText: string): string[] {
  const parsed = parseYamlOrThrow<Record<string, unknown>>(yamlText);
  return Object.entries(parsed)
    .filter(([, value]) => !(Array.isArray(value) && value.length === 0))
    .map(([key]) => key)
    .sort();
}

const descriptionOf = (yamlText: string): unknown =>
  parseYamlOrThrow<Record<string, unknown>>(yamlText)['description'];

describe('cpm rollback matches resource_manager rollback (Streamable HTTP)', () => {
  let proc: ChildProcess | null = null;
  let client: StreamableHttpMcpClient | null = null;
  let workspace = '';
  let requestId = 1;

  // Measured per type in `beforeAll`, asserted per type below: one boot serves every case.
  const observed: Record<string, { cli: string; server: string }> = {};

  const callTool = async (
    name: string,
    args: Record<string, unknown>
  ): Promise<{ isError: boolean; text: string }> => {
    if (!client) throw new Error('client not initialized');
    const result = (await client.request('tools/call', { name, arguments: args }, ++requestId)) as {
      isError?: boolean;
      content?: Array<{ text?: string }>;
    };
    return {
      isError: result.isError === true,
      text: (result.content ?? []).map((part) => part.text ?? '').join('\n'),
    };
  };

  beforeAll(async () => {
    const port = await getAvailablePort();
    const baseUrl = `http://localhost:${port}`;
    workspace = await mkdtemp(path.join(tmpdir(), 'cli-rollback-parity-ws-'));
    // The runtime root IS the workspace, as it is for the Claude Code plugin. The CLI finds
    // `state.db` by walking up from the resource directory, so a runtime root elsewhere would
    // make every case fail with "Unable to resolve resource DB path" rather than on its merits.
    proc = startServerWithHttp(port, {
      transport: 'streamable-http',
      env: { MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: workspace },
    });
    await waitForHealth(baseUrl, { timeout: 20000, interval: 200 });
    client = new StreamableHttpMcpClient(baseUrl);
    await client.initialize();

    for (const [type, spec] of Object.entries(CASES)) {
      const cliId = `cli_${type}_probe`;
      const serverId = `srv_${type}_probe`;

      for (const id of [cliId, serverId]) {
        const created = await callTool('resource_manager', spec.create(id));
        if (created.isError) throw new Error(`create ${type} ${id}: ${created.text}`);
        const updated = await callTool('resource_manager', spec.update(id));
        if (updated.isError) throw new Error(`update ${type} ${id}: ${updated.text}`);
      }

      const run = spawnSync(
        'node',
        [CPM_ENTRY, 'rollback', type, cliId, '1', '-w', workspace, '--json'],
        {
          env: buildServerEnv({
            HOME: workspace,
            MCP_WORKSPACE: workspace,
            MCP_RUNTIME_ROOT: workspace,
            // `version_history` is tenant-scoped, and both sides derive the tenant from
            // `CLAUDE_PROJECT_DIR` → cwd. The server runs from `<repo>/server`; point the CLI at
            // the same directory or it reads a different tenant and finds no version 1.
            CLAUDE_PROJECT_DIR: SERVER_ROOT,
          }),
          cwd: workspace,
          encoding: 'utf8',
        }
      );
      if (run.status !== 0) {
        throw new Error(`cpm rollback ${type}: exit ${run.status ?? -1}: ${run.stderr ?? ''}`);
      }

      const restored = await callTool('resource_manager', {
        resource_type: type,
        action: 'rollback',
        id: serverId,
        version: 1,
        confirm: true,
      });
      if (restored.isError) throw new Error(`server rollback ${type}: ${restored.text}`);

      observed[type] = {
        cli: await readFile(spec.entryFile(workspace, cliId), 'utf8'),
        server: await readFile(spec.entryFile(workspace, serverId), 'utf8'),
      };
    }
  }, 120000);

  afterAll(async () => {
    if (proc) await killServer(proc);
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  for (const type of Object.keys(CASES)) {
    it(`writes no key the server's ${type} writer does not`, () => {
      const files = observed[type];
      expect(files).toBeDefined();
      expect(comparableKeys(files!.cli)).toEqual(comparableKeys(files!.server));
    });

    it(`restores the ${type} on both paths`, () => {
      // The control for the assertion above: two files that were never touched would also match.
      const files = observed[type];
      expect(descriptionOf(files!.cli)).toBe('V1-DESC');
      expect(descriptionOf(files!.server)).toBe('V1-DESC');
    });
  }
});

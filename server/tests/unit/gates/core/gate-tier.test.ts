/**
 * Unit requirement classification and registry parity, plus real static export artifacts.
 * Export controls use private filesystem/SQLite roots and both actual adapters; they establish
 * neither live semantic loader acceptance nor executed checks or model evaluation quality.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, test } from '@jest/globals';
import * as yaml from 'js-yaml';

import {
  deriveGateTier,
  hasToolCheck,
  hasSemanticEvaluation,
  formatCheckLine,
  type GateTierSource,
} from '../../../../src/engine/gates/core/gate-tier.js';

import {
  runSkillsSyncCommand,
  type SkillsSyncPaths,
} from '../../../../src/modules/skills-sync/service.js';

import { SqliteEngine } from '../../../../src/infra/database/index.js';
import type { Logger } from '../../../../src/infra/logging/index.js';
import type { PendingGateTier } from '../../../../src/shared/types/chain-execution.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.resolve(__dirname, '../../../../resources/gates');
const INDEX_PATH = path.join(GATES_DIR, '_index.md');

describe('deriveGateTier — unit cases', () => {
  test('shell_verify criterion is a check', () => {
    const def: GateTierSource = { pass_criteria: [{ type: 'shell_verify' }] };
    expect(deriveGateTier(def)).toBe('check');
  });

  test('script_tool criterion is a check', () => {
    const def: GateTierSource = { pass_criteria: [{ type: 'script_tool' }] };
    expect(deriveGateTier(def)).toBe('check');
  });

  test('inline_guidance only is a reminder', () => {
    const def: GateTierSource = { pass_criteria: [{ type: 'inline_guidance' }] };
    expect(deriveGateTier(def)).toBe('reminder');
  });

  test('no pass_criteria at all is a reminder', () => {
    const def: GateTierSource = {};
    expect(deriveGateTier(def)).toBe('reminder');
  });

  test('inline_guidance with pattern/length fields is still a reminder — ruling B9: those fields have no evaluator', () => {
    const def: GateTierSource = {
      pass_criteria: [
        {
          type: 'inline_guidance',
          // Cast: pattern/length fields aren't part of the narrow GateTierSource shape this
          // function reads — they're here to prove their presence doesn't flip the tier.
          ...({ required_patterns: ['must include this'] } as Record<string, unknown>),
        },
      ],
    };
    expect(deriveGateTier(def)).toBe('reminder');
  });
});

describe('authored semantic and mixed component requirements', () => {
  test('semantic-only criteria classify as evaluation with no tool claim', () => {
    const definition: GateTierSource = { pass_criteria: [{ type: 'semantic_evaluation' }] };
    const serialized: PendingGateTier = deriveGateTier(definition);
    expect(serialized).toBe('evaluation');
    expect(hasSemanticEvaluation(definition)).toBe(true);
    expect(hasToolCheck(definition)).toBe(false);
  });
  test.each(['shell_verify', 'script_tool'])(
    'mixed %s preserves tool precedence and both component facts',
    (type) => {
      for (const pass_criteria of [
        [{ type: 'semantic_evaluation' }, { type }],
        [{ type }, { type: 'semantic_evaluation' }],
      ]) {
        const definition: GateTierSource = { pass_criteria };
        expect(deriveGateTier(definition)).toBe('check');
        expect(hasToolCheck(definition)).toBe(true);
        expect(hasSemanticEvaluation(definition)).toBe(true);
      }
    }
  );
  test.each([
    {},
    { pass_criteria: [] },
    { pass_criteria: [{}] },
    { pass_criteria: [{ type: 'inline_guidance' }] },
    { pass_criteria: [{ type: 'framework_compliance' }] },
    { pass_criteria: [{ type: 'unknown_future_kind' }] },
  ])('unknown/legacy requirement %j remains reminder with neither component', (definition) => {
    expect(deriveGateTier(definition)).toBe('reminder');
    expect(hasToolCheck(definition)).toBe(false);
    expect(hasSemanticEvaluation(definition)).toBe(false);
  });
  test('frozen authored facts are read without mutation', () => {
    const definition = Object.freeze({
      pass_criteria: Object.freeze([Object.freeze({ type: 'semantic_evaluation' })]),
    });
    expect(deriveGateTier(definition)).toBe('evaluation');
    expect(definition.pass_criteria).toEqual([{ type: 'semantic_evaluation' }]);
  });
});

describe('formatCheckLine — one formatter shared by the runtime renderer and skills export', () => {
  test('shell_verify with an argv shell_command names the joined command', () => {
    const line = formatCheckLine('Test Suite', [
      { type: 'shell_verify', shell_command: ['npm', 'test'] },
    ]);
    expect(line).toBe('- **Test Suite** — check: runs `npm test`');
  });

  test('shell_verify with a legacy string shell_command (pre-argv-migration gate.yaml) names it as written', () => {
    const line = formatCheckLine('Test Suite', [
      { type: 'shell_verify', shell_command: 'npm test' },
    ]);
    expect(line).toBe('- **Test Suite** — check: runs `npm test`');
  });

  test('script_tool names the tool id', () => {
    const line = formatCheckLine('Lint Tool', [
      { type: 'script_tool', script_tool_id: 'lint-runner' },
    ]);
    expect(line).toBe('- **Lint Tool** — check: runs tool `lint-runner`');
  });

  test('neither a command nor a tool id still lists the gate', () => {
    const line = formatCheckLine('Broken Check', [{ type: 'shell_verify' }]);
    expect(line).toBe('- **Broken Check** — check');
  });
});

describe('deriveGateTier — registry cross-check against generated _index.md', () => {
  // _index.md's Tier column is the generator script's (server/scripts/generate-gate-index.js)
  // own JS copy of this rule, already applied and written to disk. Comparing deriveGateTier
  // (TS) against that column — rather than against a duplicate JS function inlined here — is
  // what makes this the ONE test that goes red when the JS and TS copies drift: a duplicate
  // inline copy could silently agree with itself while both disagreed with the real script.
  test('_index.md exists and is up-to-date — run `npm run generate:gate-index` if this fails', () => {
    expect(existsSync(INDEX_PATH)).toBe(true);
  });

  test('every gate.yaml agrees with the generated _index.md Tier column, and both agree with deriveGateTier', () => {
    const indexContent = readFileSync(INDEX_PATH, 'utf-8');
    const tierByIdFromIndex = new Map<string, string>();
    for (const line of indexContent.split('\n')) {
      const match = line.match(/^\|\s*`([a-z0-9-]+)`\s*\|\s*(check|evaluation|reminder)\s*\|/);
      if (match) {
        tierByIdFromIndex.set(match[1], match[2]);
      }
    }

    const gateDirs = readdirSync(GATES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'config')
      .map((e) => e.name);

    // Guards the enumeration itself, the way `gate-definition-loader.test.ts` does for the
    // schema sweep: a per-gate comparison that silently found zero gates would still pass.
    // 26 = the 25 registry gates plus `handoff-artifacts` (row 1.3).
    expect(gateDirs.length).toBe(26);
    expect(tierByIdFromIndex.size).toBe(26);

    for (const dirName of gateDirs) {
      const yamlPath = path.join(GATES_DIR, dirName, 'gate.yaml');
      const raw = yaml.load(readFileSync(yamlPath, 'utf-8')) as {
        id: string;
        pass_criteria?: Array<{ type?: string }>;
      };

      const tsTier = deriveGateTier(raw);
      const indexTier = tierByIdFromIndex.get(raw.id);

      expect(indexTier).toBeDefined();
      expect(indexTier).toBe(tsTier);
    }
  });
});

const executeNode = promisify(execFile);
const publicSemantic = {
  type: 'semantic_evaluation',
  id: 'public-contract',
  target: { kind: 'step_output' },
  question: 'Does the output meet the public contract?',
  evidence_requirements: { min_items: 1 },
  result: { kind: 'boolean' },
  acceptance: { kind: 'equals', value: true },
};
const projectionKinds = [
  {
    id: 'public-tool',
    pass_criteria: [{ type: 'shell_verify', shell_command: ['node', '--version'] }],
  },
  { id: 'public-semantic', pass_criteria: [publicSemantic] },
  {
    id: 'public-mixed',
    pass_criteria: [{ type: 'script_tool', script_tool_id: 'public-script' }, publicSemantic],
  },
  { id: 'public-reminder', pass_criteria: [{ type: 'inline_guidance' }] },
];

async function outputFiles(
  root: string,
  prefix = ''
): Promise<Array<{ name: string; content: string }>> {
  const files: Array<{ name: string; content: string }> = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await outputFiles(root, name)));
    else files.push({ name, content: await readFile(path.join(root, name), 'utf8') });
  }
  return files;
}

describe('actual static gate projection artifacts', () => {
  test('plain JS generator import leaves catalog untouched and renders four authored kinds with TS parity', async () => {
    const generator = pathToFileURL(
      path.resolve(__dirname, '../../../../scripts/generate-gate-index.js')
    ).href;
    const before = readFileSync(INDEX_PATH, 'utf8');
    const mtime = statSync(INDEX_PATH).mtimeMs;
    const script = `const {deriveGateTier,renderIndex}=await import(${JSON.stringify(generator)}); const gates=JSON.parse(process.argv[1]); process.stdout.write(JSON.stringify({tiers:gates.map(deriveGateTier),index:renderIndex(gates)}));`;
    const { stdout } = await executeNode(process.execPath, [
      '--input-type=module',
      '-e',
      script,
      JSON.stringify(projectionKinds),
    ]);
    const generated = JSON.parse(stdout) as { tiers: string[]; index: string };
    expect(generated.tiers).toEqual(projectionKinds.map(deriveGateTier));
    expect(generated.tiers).toEqual(['check', 'evaluation', 'check', 'reminder']);
    expect(generated.index).toContain('| `public-semantic` | evaluation | semantic evaluation |');
    expect(generated.index).toContain(
      '| `public-mixed` | check | tool requirement + semantic evaluation |'
    );
    expect(generated.index).toContain('This static index proves no execution');
    expect(readFileSync(INDEX_PATH, 'utf8')).toBe(before);
    expect(statSync(INDEX_PATH).mtimeMs).toBe(mtime);
  });

  test.each(['claude-code', 'codex'])(
    '%s real export retains semantic/mixed artifacts and public metadata without private suite payload',
    async (client) => {
      const root = await mkdtemp(path.join(tmpdir(), 'semantic-static-export-'));
      let database: SqliteEngine | undefined;
      try {
        const resourceDir = (name: string) => path.join(root, 'resources', name);
        for (const name of ['prompts', 'gates', 'frameworks', 'styles'])
          await mkdir(resourceDir(name), { recursive: true });
        const promptDir = path.join(resourceDir('prompts'), 'testing', 'projection-fixture');
        await mkdir(promptDir, { recursive: true });
        await writeFile(path.join(promptDir, 'user-message.md'), 'Produce the requested work.');
        await writeFile(
          path.join(promptDir, 'prompt.yaml'),
          yaml.dump({
            id: 'projection-fixture',
            name: 'Projection Fixture',
            description: 'Static export fixture',
            category: 'testing',
            userMessageTemplateFile: 'user-message.md',
            gateConfiguration: { include: projectionKinds.map((gate) => gate.id) },
          })
        );
        const opaque = ' opaque-suite-identifier ';
        for (const gate of projectionKinds) {
          const dir = path.join(resourceDir('gates'), gate.id);
          await mkdir(dir, { recursive: true });
          await writeFile(
            path.join(dir, 'gate.yaml'),
            yaml.dump({
              ...gate,
              name: gate.id,
              description: 'Public requirement',
              type: 'validation',
              subject: 'covered-subject',
              evaluation: { mode: 'judge', model: 'public-model-hint', strict: true },
              calibration_suite_id: opaque,
              guidanceFile: 'guidance.md',
            })
          );
          await writeFile(path.join(dir, 'guidance.md'), 'Public guidance only.');
        }
        const privateDir = path.join(root, 'resources', 'calibration-suites', 'private-suite');
        await mkdir(privateDir, { recursive: true });
        await writeFile(
          path.join(privateDir, 'private-cases.json'),
          'PRIVATE_SENTINEL_CASE_LABEL_AND_PAYLOAD'
        );
        const destination = path.join(root, 'output');
        await writeFile(
          path.join(root, 'skills-sync.yaml'),
          yaml.dump({
            registrations: { [client]: 'all' },
            overrides: { [client]: { outputDir: { user: destination, project: destination } } },
          })
        );
        const paths: SkillsSyncPaths = {
          packageRoot: root,
          workspace: undefined,
          runtimeStateDir: path.join(root, 'runtime'),
          serverConfigPath: path.join(root, 'config.json'),
          sourceRoots: {
            prompt: [resourceDir('prompts')],
            gate: [resourceDir('gates')],
            framework: [resourceDir('frameworks')],
            style: [resourceDir('styles')],
          },
          writeRoots: {
            prompt: resourceDir('prompts'),
            gate: resourceDir('gates'),
            framework: resourceDir('frameworks'),
            style: resourceDir('styles'),
          },
          bundledRoots: {
            prompt: resourceDir('prompts'),
            gate: resourceDir('gates'),
            framework: resourceDir('frameworks'),
            style: resourceDir('styles'),
          },
        };
        const logger: Logger = {
          debug: () => undefined,
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        };
        database = await SqliteEngine.getInstance(logger, { dbPath: path.join(root, 'state.db') });
        await database.initialize();
        for (const harnessCovers of [['covered-subject'], []]) {
          await writeFile(paths.serverConfigPath, JSON.stringify({ gates: { harnessCovers } }));
          const report = await runSkillsSyncCommand(
            {
              command: 'export',
              client,
              scope: 'user',
              resourceType: 'prompt',
              id: 'projection-fixture',
              dbManager: database,
            },
            { log: () => undefined, warn: () => undefined, error: () => undefined },
            paths
          );
          expect(report.written).toBeGreaterThan(0);
          expect(report.failures).toEqual([]);
          const files = await outputFiles(destination);
          const skill = files.find((file) => file.name.endsWith('SKILL.md'))?.content;
          expect(skill).toContain('### Checks');
          expect(skill).toContain('not executed by export');
          expect(skill).toContain('### Evaluation Requirements');
          expect(skill).toContain('### Semantic Evaluation: public-semantic');
          expect(skill).toContain('### Semantic Evaluation: public-mixed');
          expect(skill).toContain('"allow_not_applicable": false');
          expect(skill).toContain('No binding is available yet.');
          expect(skill).toContain('state as met, unmet, insufficient_evidence or not_applicable');
          const finalProtocol = skill!.slice(skill!.indexOf('### Enforcement Protocol'));
          expect(finalProtocol).toContain(
            'captured MCP node output and its unchanged server-issued binding'
          );
          expect(finalProtocol).toContain('gate_verdict.per_gate[].evaluation');
          expect(finalProtocol).toContain('semantic acceptance is UNAVAILABLE');
          expect(finalProtocol).toContain(
            'Stop-hook PASS are self-review/turn-stop attestations only'
          );
          expect(finalProtocol).toContain('NEVER establish a semantic grade');

          const expectedIds =
            harnessCovers.length > 0
              ? ['public-tool', 'public-semantic', 'public-mixed']
              : projectionKinds.map((gate) => gate.id);
          const manifestFile = files.find((file) =>
            file.name.endsWith(path.join('gates', 'index.json'))
          )!;
          const manifest = JSON.parse(manifestFile.content) as {
            gates: Array<{
              id: string;
              evaluation: unknown;
              calibration_suite_id: string;
              pass_criteria: unknown[];
            }>;
          };
          expect(manifest.gates.map((gate) => gate.id).sort()).toEqual([...expectedIds].sort());
          for (const gate of manifest.gates) {
            const exportedYaml = files.find((file) =>
              file.name.endsWith(path.join('gates', gate.id, 'gate.yaml'))
            )!.content;
            expect(yaml.load(exportedYaml)).toMatchObject({
              evaluation: { mode: 'judge', model: 'public-model-hint', strict: true },
              calibration_suite_id: opaque,
            });

            expect(gate.evaluation).toEqual({
              mode: 'judge',
              model: 'public-model-hint',
              strict: true,
            });
            expect(gate.calibration_suite_id).toBe(opaque);
            expect(
              files.filter((file) => file.name.endsWith(path.join('gates', gate.id, 'gate.yaml')))
            ).toHaveLength(1);
          }
          expect(files.flatMap((file) => [file.name, file.content]).join('\n')).not.toContain(
            'PRIVATE_SENTINEL'
          );
          expect(files.map((file) => file.name).join('\n')).not.toContain('private-cases');
          if (harnessCovers.length > 0) expect(skill).toContain('Omitted 1 reminder');
          else expect(skill).toContain('### Reminders');
        }
        // Actual no-semantic export must preserve the preexisting final protocol bytes.
        await writeFile(
          path.join(promptDir, 'prompt.yaml'),
          yaml.dump({
            id: 'projection-fixture',
            name: 'Projection Fixture',
            description: 'Static export fixture',
            category: 'testing',
            userMessageTemplateFile: 'user-message.md',
            gateConfiguration: { include: ['public-tool', 'public-reminder'] },
          })
        );
        const legacyReport = await runSkillsSyncCommand(
          {
            command: 'export',
            client,
            scope: 'user',
            resourceType: 'prompt',
            id: 'projection-fixture',
            dbManager: database,
          },
          { log: () => undefined, warn: () => undefined, error: () => undefined },
          paths
        );
        expect(legacyReport.failures).toEqual([]);
        const legacySkill = (await outputFiles(destination)).find((file) =>
          file.name.endsWith('SKILL.md')
        )!.content;
        const legacyProtocol =
          '### Enforcement Protocol\n\n' +
          'Before completing this task, you MUST self-review against all gate criteria:\n\n' +
          '1. Complete all work specified in the task\n' +
          "2. Evaluate output against EACH gate's guidance (`gates/{id}/guidance.md`)\n" +
          '3. Emit verdict: `GATE_REVIEW: PASS — [rationale]` or `GATE_REVIEW: FAIL — [rationale]`\n' +
          '4. If FAIL: address issues and re-emit until PASS\n' +
          '\n> Not mechanically enforced on this client — treat the verdict as a required self-review.\n\n';
        expect(legacySkill).toContain(legacyProtocol);
        expect(legacySkill).not.toContain('semantic acceptance is UNAVAILABLE');
      } finally {
        await database?.shutdown();
        await rm(root, { recursive: true, force: true });
      }
    }
  );
});

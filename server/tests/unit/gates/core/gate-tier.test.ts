/**
 * Unit requirement classification plus a registry/index cross-check for shipped resources.
 * Raw semantic fixtures do not establish loader acceptance, runtime execution or export parity.
 * Classification: Unit (repo-local YAML/index fixtures; no provider or network).
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';
import * as yaml from 'js-yaml';

import {
  deriveGateTier,
  hasToolCheck,
  hasSemanticEvaluation,
  formatCheckLine,
  type GateTierSource,
} from '../../../../src/engine/gates/core/gate-tier.js';

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
      const match = line.match(/^\|\s*`([a-z0-9-]+)`\s*\|\s*(check|reminder)\s*\|/);
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

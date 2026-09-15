/**
 * `deriveGateTier` (server/src/engine/gates/core/gate-tier.ts) and its JS mirror in
 * `server/scripts/generate-gate-index.js` implement the SAME rule twice — one in TS for
 * runtime callers, one in plain JS so the generator script needs no build step. Nothing else
 * enforces the two stay in step.
 *
 * The unit cases below pin the rule itself. The registry cross-check is the only thing that
 * fails when the JS and TS copies drift: it loads every gate's `gate.yaml` under
 * `server/resources/gates`, parses the generated `_index.md`'s Tier column, and asserts
 * `deriveGateTier` agrees with what the generator already wrote for all 26 gates. If someone
 * edits the JS rule (or the TS rule) without updating the other, this test — and only this
 * test — goes red.
 *
 * Classification: Unit (no network; reads repo-local gate.yaml and _index.md fixtures)
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';
import * as yaml from 'js-yaml';

import {
  deriveGateTier,
  type GateTierSource,
} from '../../../../src/engine/gates/core/gate-tier.js';

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

// @lifecycle canonical - Unit tests for the shared resource quarantine and its loader wiring (P4.9, P4.15)
/**
 * The collection that holds refused resource files, and the loader that fills it.
 *
 * Four properties are load-bearing and none is observable from a passing load:
 *
 *   1. A record carries NO content. The instruction surface (systemMessage, description, argument
 *      descriptions, user template) is exactly what a client receives before invoking anything,
 *      and a quarantined file is the one whose content has not been validated. The shape test
 *      below fails if a content field is ever added, which a type alone cannot do at runtime.
 *   2. Records are keyed by (root, path), never by id. Keying by id would make a broken workspace
 *      file evict a broken bundled one and lose the path a repair needs.
 *   3. `beginRoot` CLEARS, and `forgetRoot` scopes that clearing by TYPE. A gate walk of a root
 *      must not erase the prompt records for that same root, or a file nobody repaired goes quiet.
 *   4. `mergeQuarantineViews` reads through to the live instances. A snapshot would freeze the
 *      catalog at wiring time and miss every hot reload.
 *
 * MUTATION-VERIFIED 2026-09-11, and one mutation changed the design. Removing `type` from the map
 * KEY killed nothing — the protection in (3) lives entirely in `forgetRoot`'s field filter, so the
 * key component was inert and is gone. Removing `type` from that filter kills the (3) test;
 * removing the type stamp from `record()` kills two; inverting `isRefused` kills three; making the
 * merged view snapshot at construction kills the (4) test. Each assertion below has been observed
 * failing, which is the only thing that makes its passing evidence.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PromptLoader } from '../../../src/modules/prompts/loader.js';
import {
  ResourceQuarantine,
  mergeQuarantineViews,
  preferredRepairTarget,
  type QuarantinedResource,
} from '../../../src/shared/utils/resource-quarantine.js';

const createLogger = () =>
  ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }) as never;

const entry = (
  overrides: Partial<QuarantinedResource> = {}
): Omit<QuarantinedResource, 'type' | 'root'> => ({
  id: 'broken',
  category: 'probecat',
  path: '/roots/a/probecat/broken/prompt.yaml',
  error: 'arguments: expected array',
  ...overrides,
});

describe('ResourceQuarantine', () => {
  it('records a refused file under the type and root that were being walked', () => {
    const quarantine = new ResourceQuarantine();
    quarantine.beginRoot('prompt', '/roots/a').record(entry());

    expect(quarantine.size).toBe(1);
    expect(quarantine.list()[0]).toEqual({
      type: 'prompt',
      id: 'broken',
      category: 'probecat',
      root: '/roots/a',
      path: '/roots/a/probecat/broken/prompt.yaml',
      error: 'arguments: expected array',
    });
  });

  it('carries no field that could be executed or rendered as instruction', () => {
    const quarantine = new ResourceQuarantine();
    quarantine.beginRoot('prompt', '/roots/a').record(entry());

    // The exact key set, not a subset check: a subset check passes when a content field is added.
    expect(Object.keys(quarantine.list()[0] as object).sort()).toEqual([
      'category',
      'error',
      'id',
      'path',
      'root',
      'type',
    ]);
  });

  it('keeps one record per (root, path), so the same id in two roots survives twice', () => {
    const quarantine = new ResourceQuarantine();
    quarantine
      .beginRoot('prompt', '/roots/a')
      .record(entry({ path: '/roots/a/x/broken/prompt.yaml' }));
    quarantine
      .beginRoot('prompt', '/roots/b')
      .record(entry({ path: '/roots/b/y/broken/prompt.yaml' }));

    expect(quarantine.size).toBe(2);
    expect(quarantine.byId('broken')).toHaveLength(2);
  });

  it('forgets only the root being re-walked', () => {
    const quarantine = new ResourceQuarantine();
    quarantine
      .beginRoot('prompt', '/roots/a')
      .record(entry({ path: '/roots/a/x/broken/prompt.yaml' }));
    quarantine
      .beginRoot('prompt', '/roots/b')
      .record(entry({ path: '/roots/b/y/other/prompt.yaml' }));

    // Re-walking A with nothing refused this time must clear A and leave B standing.
    quarantine.beginRoot('prompt', '/roots/a');

    expect(quarantine.list().map((record) => record.root)).toEqual(['/roots/b']);
  });

  it('forgets only the TYPE being re-walked, so one loader cannot erase another', () => {
    // The reason `beginRoot` takes a type at all. Without it, a gate walk of a root that refused
    // nothing would clear the prompt records for that same root and the repair path would go dark
    // for files nothing had repaired.
    const quarantine = new ResourceQuarantine();
    quarantine
      .beginRoot('prompt', '/roots/a')
      .record(entry({ path: '/roots/a/x/broken/prompt.yaml' }));
    quarantine
      .beginRoot('gate', '/roots/a')
      .record(entry({ id: 'broken_gate', path: '/roots/a/broken_gate/gate.yaml' }));

    quarantine.beginRoot('gate', '/roots/a');

    expect(quarantine.list().map((record) => record.type)).toEqual(['prompt']);
  });

  it('answers isRefused by path, which is what a consumer holding a file walk has', () => {
    const quarantine = new ResourceQuarantine();
    quarantine.beginRoot('prompt', '/roots/a').record(entry());

    expect(quarantine.isRefused('/roots/a/probecat/broken/prompt.yaml')).toBe(true);
    // Positive control for the negative: a sibling path in the same root is NOT refused, so a
    // blanket-true implementation cannot pass both halves.
    expect(quarantine.isRefused('/roots/a/probecat/good/prompt.yaml')).toBe(false);
  });

  it('returns nothing for an id it never refused', () => {
    const quarantine = new ResourceQuarantine();
    quarantine.beginRoot('prompt', '/roots/a').record(entry());

    expect(quarantine.byId('some_other_prompt')).toEqual([]);
  });
});

describe('mergeQuarantineViews', () => {
  it('reads through to the live instances rather than copying', () => {
    const prompts = new ResourceQuarantine();
    const gates = new ResourceQuarantine();
    const merged = mergeQuarantineViews(prompts, gates);

    expect(merged.size).toBe(0);

    // Recorded AFTER the merge was built: a snapshot-copying implementation stays at 0 here, which
    // is the hot-reload failure this view exists to avoid.
    prompts.beginRoot('prompt', '/roots/a').record(entry());
    gates
      .beginRoot('gate', '/roots/a')
      .record(entry({ id: 'broken_gate', path: '/roots/a/broken_gate/gate.yaml' }));

    expect(merged.size).toBe(2);
    expect(
      merged
        .list()
        .map((record) => record.type)
        .sort()
    ).toEqual(['gate', 'prompt']);
    expect(merged.isRefused('/roots/a/broken_gate/gate.yaml')).toBe(true);
    expect(merged.isRefused('/roots/a/probecat/good/prompt.yaml')).toBe(false);
  });

  it('collects every root claiming one id across the views it spans', () => {
    const prompts = new ResourceQuarantine();
    const gates = new ResourceQuarantine();
    prompts.beginRoot('prompt', '/roots/a').record(entry({ id: 'shared_id' }));
    gates
      .beginRoot('gate', '/roots/b')
      .record(entry({ id: 'shared_id', path: '/roots/b/shared_id/gate.yaml' }));

    expect(mergeQuarantineViews(prompts, gates).byId('shared_id')).toHaveLength(2);
  });
});

describe('preferredRepairTarget', () => {
  const inA: QuarantinedResource = { ...entry(), type: 'prompt', root: '/roots/a' };
  const inB: QuarantinedResource = {
    ...entry({ path: '/roots/b/probecat/broken/prompt.yaml' }),
    type: 'prompt',
    root: '/roots/b',
  };

  it('prefers the writable primary root when several hold the same broken id', () => {
    expect(preferredRepairTarget([inB, inA], '/roots/a')).toBe(inA);
  });

  it('falls back to the first record when the primary holds none', () => {
    expect(preferredRepairTarget([inB, inA], '/roots/elsewhere')).toBe(inB);
  });

  it('is undefined for an id nothing quarantined', () => {
    expect(preferredRepairTarget([], '/roots/a')).toBeUndefined();
  });
});

describe('PromptLoader fills the quarantine from a real directory walk', () => {
  /** A prompts root holding one valid prompt and one schema-invalid one. */
  const buildRoot = (): string => {
    const root = mkdtempSync(path.join(tmpdir(), 'quarantine-loader-'));
    mkdirSync(path.join(root, 'probecat', 'good_prompt'), { recursive: true });
    writeFileSync(
      path.join(root, 'probecat', 'good_prompt', 'prompt.yaml'),
      'id: good_prompt\nname: Good\ncategory: probecat\ndescription: valid\nuserMessageTemplate: "Hello"\n'
    );
    mkdirSync(path.join(root, 'probecat', 'broken_prompt'), { recursive: true });
    writeFileSync(
      path.join(root, 'probecat', 'broken_prompt', 'prompt.yaml'),
      'id: broken_prompt\nname: Broken\ncategory: probecat\ndescription: invalid\nuserMessageTemplate: "Body"\narguments: "not-an-array"\n'
    );
    return root;
  };

  it('records the refused file with the category and path a repair needs, and leaves the valid one alone', async () => {
    const root = buildRoot();
    try {
      const loader = new PromptLoader(createLogger());
      const result = await loader.loadFromDirectories(root);

      // The positive control for the whole mechanism: the valid prompt still loads. A quarantine
      // that recorded everything would satisfy every assertion below on its own.
      expect(result.promptsData.map((prompt) => prompt.id)).toEqual(['good_prompt']);
      expect(result.invalid).toBe(1);

      const records = loader.getQuarantine().list();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        type: 'prompt',
        id: 'broken_prompt',
        category: 'probecat',
        root,
        path: path.join(root, 'probecat', 'broken_prompt', 'prompt.yaml'),
      });
      expect(records[0]?.error).toContain('arguments');

      // The path-keyed query the indexer and change tracker read (P4.14), against its own control.
      expect(
        loader
          .getQuarantine()
          .isRefused(path.join(root, 'probecat', 'broken_prompt', 'prompt.yaml'))
      ).toBe(true);
      expect(
        loader.getQuarantine().isRefused(path.join(root, 'probecat', 'good_prompt', 'prompt.yaml'))
      ).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('drops the record once the file is repaired and the root re-walked', async () => {
    const root = buildRoot();
    try {
      const loader = new PromptLoader(createLogger());
      await loader.loadFromDirectories(root);
      expect(loader.getQuarantine().byId('broken_prompt')).toHaveLength(1);

      writeFileSync(
        path.join(root, 'probecat', 'broken_prompt', 'prompt.yaml'),
        'id: broken_prompt\nname: Broken\ncategory: probecat\ndescription: repaired\nuserMessageTemplate: "Body"\n'
      );
      loader.clearCache();
      const reloaded = await loader.loadFromDirectories(root);

      expect(reloaded.promptsData.map((prompt) => prompt.id).sort()).toEqual([
        'broken_prompt',
        'good_prompt',
      ]);
      expect(loader.getQuarantine().list()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';
import * as yaml from 'js-yaml';

import {
  applyRegistrationMutations,
  previewRegistrationMutations,
} from '../../../src/modules/skills-sync/config/registration-store.js';

describe('registration-store', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  async function makeConfigFile(initial: string): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'skills-sync-config-'));
    tempDirs.push(dir);
    const configPath = path.join(dir, 'skills-sync.yaml');
    await writeFile(configPath, initial, 'utf-8');
    return configPath;
  }

  it('adds new registration keys for client/scope', async () => {
    const configPath = await makeConfigFile(`
registrations:
  claude-code:
    user:
      - prompt:development/review
`);

    const result = await applyRegistrationMutations(configPath, [
      {
        clientId: 'claude-code',
        scope: 'user',
        resourceKeys: ['prompt:workflow/triage'],
      },
    ]);

    expect(result).toEqual({ updated: true, addedKeys: 1 });

    const raw = await readFile(configPath, 'utf-8');
    const parsed = yaml.load(raw) as {
      registrations: { 'claude-code': { user: string[] } };
    };
    expect(parsed.registrations['claude-code'].user).toEqual([
      'prompt:development/review',
      'prompt:workflow/triage',
    ]);
  });

  it('is a no-op when all keys already exist', async () => {
    const configPath = await makeConfigFile(`
registrations:
  claude-code:
    user:
      - prompt:development/review
`);

    const result = await applyRegistrationMutations(configPath, [
      {
        clientId: 'claude-code',
        scope: 'user',
        resourceKeys: ['prompt:development/review'],
      },
    ]);

    expect(result).toEqual({ updated: false, addedKeys: 0 });
  });

  it('does not mutate client registration when set to all', async () => {
    const configPath = await makeConfigFile(`
registrations:
  claude-code: all
`);

    const result = await applyRegistrationMutations(configPath, [
      {
        clientId: 'claude-code',
        scope: 'user',
        resourceKeys: ['prompt:workflow/triage'],
      },
    ]);

    expect(result).toEqual({ updated: false, addedKeys: 0 });

    const raw = await readFile(configPath, 'utf-8');
    const parsed = yaml.load(raw) as { registrations: { 'claude-code': string } };
    expect(parsed.registrations['claude-code']).toBe('all');
  });

  it('previews registration mutations without writing file changes', async () => {
    const configPath = await makeConfigFile(`
registrations:
  claude-code:
    user:
      - prompt:development/review
`);
    const before = await readFile(configPath, 'utf-8');

    const result = await previewRegistrationMutations(configPath, [
      {
        clientId: 'claude-code',
        scope: 'user',
        resourceKeys: ['prompt:workflow/triage'],
      },
    ]);

    expect(result).toEqual({ updated: true, addedKeys: 1 });
    const after = await readFile(configPath, 'utf-8');
    expect(after).toBe(before);
  });
});

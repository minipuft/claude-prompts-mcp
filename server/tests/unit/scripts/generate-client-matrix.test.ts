/**
 * The README's client dropdown is generated from docs/reference/clients.json, and one row can stand
 * for several clients. The row has one hook badge, so a shared row whose clients differ in hook
 * coverage would misstate some of them; validation refuses that data.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';

import { renderReadmeSetup, validateClients } from '../../../scripts/generate-client-matrix.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = join(here, '..', '..', '..', '..', 'docs', 'reference', 'clients.json');

const solo = { id: 'solo', name: 'Solo', install: 'Plugin', hooks: 'full', steps: ['Run it.'] };
const first = { id: 'first', name: 'First', hooks: 'none' };
const second = { id: 'second', name: 'Second', hooks: 'none' };
const shared = {
  id: 'pair',
  name: 'First, Second',
  install: 'MCP config',
  clients: ['first', 'second'],
  steps: ['Add the block.'],
};

describe('validateClients', () => {
  test('accepts the data file the README is generated from', () => {
    expect(validateClients(JSON.parse(readFileSync(dataPath, 'utf-8')))).toEqual([]);
  });

  test('accepts a shared setup whose clients agree on hook coverage', () => {
    expect(validateClients({ clients: [solo, first, second], sharedSetups: [shared] })).toEqual([]);
  });

  test('refuses a shared setup whose clients differ in hook coverage', () => {
    const errors = validateClients({
      clients: [solo, first, { ...second, hooks: 'partial' }],
      sharedSetups: [shared],
    });
    expect(errors).toEqual([expect.stringContaining('differ in hook coverage')]);
  });

  test('refuses a shared setup that names an unknown client', () => {
    const errors = validateClients({ clients: [solo, first], sharedSetups: [shared] });
    expect(errors).toEqual([expect.stringContaining('unknown client "second"')]);
  });

  test('refuses a client with no steps and no shared setup', () => {
    const errors = validateClients({ clients: [{ ...solo, steps: undefined }] });
    expect(errors).toEqual([expect.stringContaining('needs "steps"')]);
  });
});

describe('renderReadmeSetup', () => {
  const output = renderReadmeSetup([solo, first, second], [shared]);

  test('counts clients, not rows, in the dropdown label', () => {
    expect(output).toContain('All 3 clients');
    expect(output).toContain('1 full · 2 MCP tools only');
  });

  test('gives a shared setup one row, placed at its first client', () => {
    expect(output.match(/<details name="clients">/g)).toHaveLength(2);
    expect(output.indexOf('Solo')).toBeLessThan(output.indexOf('First, Second'));
    expect(output).not.toContain('<strong>Second</strong>');
  });

  test('wraps each hook badge in <picture> so a click toggles the row', () => {
    const badges = output.match(/<img [^>]*>/g) ?? [];
    expect(badges).toHaveLength(2);
    expect(output.match(/<picture><img /g)).toHaveLength(2);
    expect(output).toContain('alt="Hooks: MCP tools only"');
  });
});

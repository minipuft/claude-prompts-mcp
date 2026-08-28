/**
 * Startup inventory formatting (T1.8).
 *
 * The property under test is that the ROOT travels with the COUNT. A count on its own cannot
 * distinguish a complete catalog from a subset — which is the whole defect: a worktree serves 39
 * of 123 prompts and its startup line was indistinguishable from a healthy one.
 */

import { describe, expect, it } from '@jest/globals';

import { formatResourceInventory } from '../../../src/runtime/resource-inventory.js';

describe('formatResourceInventory', () => {
  it('names the root alongside the count', () => {
    const [line] = formatResourceInventory({
      resource: 'prompts',
      root: '/srv/resources/prompts',
      count: 39,
    });

    expect(line).toContain('/srv/resources/prompts');
    expect(line).toContain('39');
  });

  it('includes the secondary count when supplied', () => {
    const [line] = formatResourceInventory({
      resource: 'prompts',
      root: '/srv/resources/prompts',
      count: 39,
      detail: { label: 'categories', value: 9 },
    });

    expect(line).toContain('39 (9 categories)');
  });

  it('omits the detail clause entirely when there is none', () => {
    const [line] = formatResourceInventory({
      resource: 'gates',
      root: '/srv/resources/gates',
      count: 25,
    });

    expect(line).toContain('gates: 25 —');
    expect(line).not.toContain('(');
  });

  it('emits a second line naming overlay directories', () => {
    const lines = formatResourceInventory({
      resource: 'prompts',
      root: '/srv/resources/prompts',
      count: 41,
      overlays: ['/ws/prompts', '/ws/resources/prompts'],
    });

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('/ws/prompts');
    expect(lines[1]).toContain('/ws/resources/prompts');
  });

  it('emits no overlay line when there are no overlays', () => {
    // Both the absent and the empty case, because the caller passes a `?? []` result and an empty
    // array reading as "there were overlays" would put a dangling line in every normal startup.
    expect(
      formatResourceInventory({ resource: 'styles', root: '/srv/styles', count: 4 })
    ).toHaveLength(1);
    expect(
      formatResourceInventory({ resource: 'styles', root: '/srv/styles', count: 4, overlays: [] })
    ).toHaveLength(1);
  });

  it('reports a zero count rather than suppressing the line', () => {
    // An empty resource directory is a diagnostic worth seeing, not a reason to stay silent.
    const [line] = formatResourceInventory({
      resource: 'frameworks',
      root: '/srv/resources/frameworks',
      count: 0,
    });

    expect(line).toContain('frameworks: 0');
    expect(line).toContain('/srv/resources/frameworks');
  });
});

import { describe, expect, test } from '@jest/globals';

import { getApplicationHealth } from '../../src/index.js';

describe('Entrypoint health reporting', () => {
  test('exposes shared health report shape with lastCheck', () => {
    const health = getApplicationHealth();

    expect(health).toHaveProperty('healthy');
    expect(health).toHaveProperty('modules');
    expect(health).toHaveProperty('details');
    expect(health).toHaveProperty('issues');
    expect(health).toHaveProperty('lastCheck');
    expect(typeof health.lastCheck).toBe('number');
  });
});

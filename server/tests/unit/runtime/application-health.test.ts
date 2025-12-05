import { describe, expect, test } from '@jest/globals';

import { createSimpleLogger } from '../../../src/logging/index.js';
import { Application } from '../../../src/runtime/application.js';

describe('Application health reporting', () => {
  test('returns healthy when core modules and data are present', () => {
    const app = new Application(createSimpleLogger('stdio'));

    // Manually seed minimal state to avoid full startup
    (app as any).logger = createSimpleLogger('stdio');
    (app as any).configManager = { getConfig: () => ({}) };
    (app as any).textReferenceManager = {};
    (app as any).promptManager = {};
    (app as any)._promptsData = [{ id: 'p1', category: 'general' }];
    (app as any)._categories = [{ id: 'general', name: 'General' }];
    (app as any)._convertedPrompts = [{ id: 'p1', category: 'general' }];
    (app as any).mcpToolsManager = {};
    (app as any).transportManager = { getTransportType: () => 'stdio' };
    (app as any).serverManager = { isRunning: () => true, getStatus: () => ({ running: true }) };

    const health = app.validateHealth();

    expect(health.healthy).toBe(true);
    expect(health.modules.foundation).toBe(true);
    expect(health.modules.dataLoaded).toBe(true);
    expect(health.modules.modulesInitialized).toBe(true);
    expect(health.modules.serverRunning).toBe(true);
    expect(health.details.promptsLoaded).toBe(1);
    expect(health.details.categoriesLoaded).toBe(1);
  });
});

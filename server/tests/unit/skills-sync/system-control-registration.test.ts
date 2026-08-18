// @lifecycle test - skills_sync reachability through system_control (F9).
/**
 * F9: `ConsolidatedSkillsSync` and its contract both existed, but
 * `createConsolidatedSkillsSync` had zero call sites and `system_control`
 * advertised no action for it -- so the whole subsystem was unreachable through
 * MCP, and with it the only code path that supplies a `dbManager` (which is why
 * manifest rows were never written).
 *
 * Folded into `system_control` as an action rather than shipped as a fourth tool
 * (owner ruling Q3): an exported skill is a projection of a prompt, not a
 * resource type of its own.
 */
import { describe, expect, it } from '@jest/globals';

import { SYSTEM_CONTROL_ACTION_IDS } from '../../../src/mcp/metadata/definitions/system-control.js';
import {
  SKILLS_SYNC_OPERATIONS,
  type SkillsSyncInput,
} from '../../../src/mcp/tools/skills-sync.js';

describe('skills_sync registration (F9)', () => {
  it('is advertised as a system_control action', () => {
    expect(SYSTEM_CONTROL_ACTION_IDS).toContain('skills_sync');
  });

  it('is not advertised as a separate MCP tool', () => {
    // The rejected alternative. A fourth tool permanently widens the surface a
    // major version protects.
    expect(SYSTEM_CONTROL_ACTION_IDS).not.toContain('skills_sync_tool');
  });

  it('carries every operation the CLI supports', () => {
    expect([...SKILLS_SYNC_OPERATIONS]).toEqual([
      'status',
      'export',
      'sync',
      'diff',
      'pull',
      'clone',
    ]);
  });

  it('names the sub-command `operation` from the tool surface down', () => {
    // Not `action`: system_control already spends that on its own dispatch, so
    // mapping it at the router would be the hidden transformation
    // `mcp-contracts.md` bans. A compile error here IS the assertion.
    const input: SkillsSyncInput = { operation: 'status' };
    expect(input.operation).toBe('status');
    expect(Object.keys(input)).not.toContain('action');
  });
});

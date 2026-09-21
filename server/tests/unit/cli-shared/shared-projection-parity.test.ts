/**
 * The two surfaces project one resource onto one snapshot.
 *
 * `cpm` and `resource_manager` both write `version_history.snapshot`, and the bridge decision is
 * equality against the newest recorded row — so a CLI-shaped projection and a server-shaped one can
 * never compare equal, and every `cpm rollback` of a server-written resource records a bridge row
 * describing a change nobody made. Measured on one gate before this was closed: `cpm` wrote
 * `{id,name,description,type,severity,guidanceFile}` where the server wrote
 * `{id,name,type,description,guidance}` with the markdown body inline.
 *
 * The assertion is equality of the two projections built from the SAME bytes on disk, through the
 * two surfaces' own entry points — not equality of two calls to the shared function, which would
 * hold however the callers were wired.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { GateDefinitionLoader } from '../../../src/engine/gates/core/gate-definition-loader.js';
import { GenericGateGuide } from '../../../src/engine/gates/registry/generic-gate-guide.js';
import { gateSnapshotContract } from '../../../src/mcp/tools/gate-manager/services/gate-snapshot-contract.js';
import { frameworkSnapshotContract } from '../../../src/mcp/tools/framework-manager/services/framework-snapshot-contract.js';
import { projectResourceSnapshot } from '../../../src/cli-shared/resource-snapshot.js';
import { loadYamlFileSync } from '../../../src/shared/utils/yaml/index.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

/** Hand-authored, with a comment and a key order no writer would produce. */
const GATE_YAML = `# hand-authored
id: alpha
name: Alpha            # trailing comment
description: A gate
type: validation
severity: medium
guidanceFile: guidance.md
`;
const GUIDANCE = '# guidance\n\nbody text\n';

const FRAMEWORK_YAML = `id: beta
name: Beta
version: 1.0.0
type: methodology
description: A framework
enabled: true
`;
const SYSTEM_PROMPT = 'system prompt body\n';

describe('one projection per resource type, read by both surfaces', () => {
  let root: string;

  beforeEach(() => {
    root = testScratchPath('shared-projection-parity');
    mkdirSync(join(root, 'gates', 'alpha'), { recursive: true });
    writeFileSync(join(root, 'gates', 'alpha', 'gate.yaml'), GATE_YAML, 'utf8');
    writeFileSync(join(root, 'gates', 'alpha', 'guidance.md'), GUIDANCE, 'utf8');
    mkdirSync(join(root, 'frameworks', 'beta'), { recursive: true });
    writeFileSync(join(root, 'frameworks', 'beta', 'framework.yaml'), FRAMEWORK_YAML, 'utf8');
    writeFileSync(join(root, 'frameworks', 'beta', 'system-prompt.md'), SYSTEM_PROMPT, 'utf8');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('projects a gate identically from the loaded guide and from the files on disk', () => {
    const entryPath = join(root, 'gates', 'alpha', 'gate.yaml');
    const definition = new GateDefinitionLoader({ gatesDir: join(root, 'gates') }).loadGate(
      'alpha'
    );
    expect(definition).toBeDefined();

    const server = gateSnapshotContract.project('alpha', new GenericGateGuide(definition!));
    const cli = projectResourceSnapshot(
      'gate',
      'alpha',
      entryPath,
      loadYamlFileSync<Record<string, unknown>>(entryPath)!
    );

    expect(cli.shared).toBe(true);
    // Key ORDER too, not just contents: the bridge check is `JSON.stringify` equality, so two
    // records holding the same data in different orders bridge on every edit (F18).
    expect(JSON.stringify(cli.snapshot)).toBe(JSON.stringify(server));
    // And the value that could not survive a raw-YAML projection is the one that matters: the
    // guidance BODY, not the file name.
    expect(server['guidance']).toBe(GUIDANCE);
    expect(cli.snapshot['guidanceFile']).toBeUndefined();
  });

  it('projects a framework identically from the loaded data and from the files on disk', () => {
    const entryPath = join(root, 'frameworks', 'beta', 'framework.yaml');
    const framework = loadYamlFileSync<Record<string, unknown>>(entryPath)!;

    const server = frameworkSnapshotContract.project('beta', {
      framework,
      phases: null,
      systemPrompt: SYSTEM_PROMPT,
      judgePrompt: null,
      frameworkPath: entryPath,
      phasesPath: null,
      systemPromptPath: join(root, 'frameworks', 'beta', 'system-prompt.md'),
      judgePromptPath: null,
    });
    const cli = projectResourceSnapshot('framework', 'beta', entryPath, framework);

    expect(cli.shared).toBe(true);
    expect(JSON.stringify(cli.snapshot)).toBe(JSON.stringify(server));
    expect(server['system_prompt_guidance']).toBe(SYSTEM_PROMPT);
  });

  it('records a gate with no guidance.md the way the server does — an empty string, not an absent key', () => {
    const bare = join(root, 'gates', 'bare');
    mkdirSync(bare, { recursive: true });
    const yaml = 'id: bare\nname: Bare\ndescription: no guidance file\ntype: validation\n';
    writeFileSync(join(bare, 'gate.yaml'), yaml, 'utf8');

    const cli = projectResourceSnapshot(
      'gate',
      'bare',
      join(bare, 'gate.yaml'),
      loadYamlFileSync<Record<string, unknown>>(join(bare, 'gate.yaml'))!
    );

    expect(cli.snapshot['guidance']).toBe('');
  });

  it('refuses to claim a shared projection for a prompt, and says why', () => {
    const cli = projectResourceSnapshot('prompt', 'demo', join(root, 'prompt.yaml'), {
      id: 'demo',
      userMessageTemplateFile: 'user-message.md',
    });

    // The negative half, stated as a value rather than as `!== true`: a prompt snapshot is still
    // the raw map, and the reason names the measured number that would flip it.
    expect(cli.shared).toBe(false);
    if (cli.shared) throw new Error('unreachable');
    expect(cli.reason).toContain('+59.0 KB');
    expect(cli.reason).toContain('2026-09-21');
    expect(cli.snapshot['userMessageTemplateFile']).toBe('user-message.md');
  });
});

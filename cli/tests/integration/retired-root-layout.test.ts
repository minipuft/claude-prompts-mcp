/**
 * A workspace whose root still holds resources in `<workspace>/<type>/` is refused by `cpm`, the
 * way the server refuses it at startup: no command lists, counts or scaffolds beside a layout the
 * server no longer reads. A root folder of those names that holds no resource definition is not a
 * resource folder and is ignored. Drives the built `cpm` (`npm run build` in `cli/`).
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCpm } from '../helpers/child-process.js';

describe('cpm refuses resources at the workspace root', () => {
  let scratch: string;
  let workspace: string;

  const run = (args: string[]) =>
    runCpm(args, { cwd: scratch, env: { HOME: join(scratch, 'home') } });

  /** One prompt below `<workspace>/<where>/demo/hello/`, the layout the old resolver served. */
  function writePrompt(where: string): void {
    const dir = join(workspace, where, 'demo', 'hello');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'prompt.yaml'),
      'id: hello\nname: hello\ncategory: demo\ndescription: probe\nuserMessageTemplate: hi\n'
    );
  }

  const moveLine = (type: string): string =>
    `Move: ${join(workspace, type)} -> ${join(workspace, 'resources', type)}`;

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'cpm-root-layout-')));
    workspace = join(scratch, 'profile');
    mkdirSync(workspace);
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('refuses `cpm list` over a root prompts folder that holds a prompt, naming the move', () => {
    writePrompt('prompts');

    const { status, stderr, stdout } = run(['list', 'prompts', '-w', workspace]);

    expect(status).toBe(1);
    expect(`${stdout}${stderr}`).toContain('Refusing to use the workspace:');
    expect(`${stdout}${stderr}`).toContain(moveLine('prompts'));
  });

  it('control: the same prompt under resources/ lists', () => {
    writePrompt(join('resources', 'prompts'));

    const { status, stdout } = run(['list', 'prompts', '-w', workspace]);

    expect(status).toBe(0);
    expect(stdout).toContain('hello');
  });

  it('control: a root scripts folder of shell files and an empty prompts folder are ignored', () => {
    writePrompt(join('resources', 'prompts'));
    mkdirSync(join(workspace, 'scripts'));
    writeFileSync(join(workspace, 'scripts', 'build.sh'), 'echo hi\n');
    mkdirSync(join(workspace, 'prompts'));

    const { status, stdout } = run(['list', 'prompts', '-w', workspace]);

    expect(status).toBe(0);
    expect(stdout).toContain('hello');
  });

  it('refuses `cpm init` over a root prompts folder that holds a prompt, scaffolding nothing', () => {
    writePrompt('prompts');

    const { status, stdout, stderr } = run(['init', workspace]);

    expect(status).toBe(1);
    expect(`${stdout}${stderr}`).toContain('Refusing to create a workspace:');
    expect(`${stdout}${stderr}`).toContain(moveLine('prompts'));
    expect(existsSync(join(workspace, 'resources'))).toBe(false);
  });

  it('refuses to register, show or use a profile folder that holds the retired layout', () => {
    const clean = join(scratch, 'clean');
    const dev = join(scratch, 'dev');
    mkdirSync(join(clean, 'resources', 'prompts'), { recursive: true });
    mkdirSync(join(dev, 'resources', 'prompts'), { recursive: true });
    const inClean = (...args: string[]) => run([...args, '-w', clean]);

    expect(inClean('workspace', 'add', 'dev', dev).status).toBe(0);
    // CONTROL: before the layout appears, show and use answer.
    expect(inClean('workspace', 'show', 'dev').status).toBe(0);
    expect(inClean('workspace', 'use', 'dev').status).toBe(0);

    const retired = join(dev, 'prompts', 'demo', 'hello');
    mkdirSync(retired, { recursive: true });
    writeFileSync(join(retired, 'prompt.yaml'), 'id: hello\n');
    const refused = [
      inClean('workspace', 'add', 'second', dev),
      inClean('workspace', 'show', 'dev'),
      inClean('workspace', 'use', 'dev'),
    ];

    for (const result of refused) {
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain(
        `Move: ${join(dev, 'prompts')} -> ${join(dev, 'resources', 'prompts')}`
      );
    }
  });
});

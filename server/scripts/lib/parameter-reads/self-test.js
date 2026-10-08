/**
 * Self-test for `validate-tool-parameter-reads`: planted fixtures and their fixed twins, one set per
 * adapter, run against an in-memory project. `subject` is what the validator hands in — its
 * `checkBindings`, `applyExceptions` and the three adapters — so this module never imports the
 * script that runs it.
 *
 * @param subject `{ checkBindings, applyExceptions, adapters: { systemControl, resourceManager, promptEngine } }`
 */

import { Project } from 'ts-morph';

const FIXTURE_ROUTER = `
export class Router {
  getActionHandler(action: string) {
    switch (action) {
      case 'demo':
        return new DemoHandler(this);
      default:
        throw new Error('unknown');
    }
  }
}
`;

/** `persistOnEnable`: whether `enable` forwards `persist`. `offReads`: whether `off` reads it back. */
function fixtureHandler({ persistOnEnable, offReads }) {
  return `
class Base {
  protected note(message: string) { return message; }
}
export class DemoHandler extends Base {
  async execute(args: any) {
    const operation = args.operation;
    switch (operation) {
      case 'enable':
        this.note("'persist' is named here, in the enable case, and read nowhere");
        return this.enable({ reason: args.reason${persistOnEnable ? ', persist: args.persist' : ''} });
      case 'disable':
        return this.disable({ reason: args.reason, persist: (args as { persist?: boolean }).persist });
      case 'list':
      case 'default':
        return this.list(args);
      default:
        throw new Error("Unknown operation. 'persist' is spelled like this.");
    }
  }
  private enable(options: { reason?: string; persist?: boolean }) {
    return this.note(String(options.reason) + String(options.persist));
  }
  private disable(options: { reason?: string; persist?: boolean }) {
    return ${offReads ? 'String(options.reason) + String(options.persist)' : "this.note(String(options.reason)) // 'persist' dropped"};
  }
  private list(input: any) {
    const { show_details } = input;
    return show_details;
  }
}
`;
}

const FIXTURE_COMMANDS = [
  { id: 'demo:enable', parameters: ['action', 'operation', 'reason', 'persist'] },
  { id: 'demo:disable', parameters: ['action', 'operation', 'reason', 'persist'] },
  { id: 'demo:list', parameters: ['action', 'operation', 'show_details'] },
];

function runSystemControl(subject, project, commands) {
  return subject.checkBindings(
    subject.adapters.systemControl.bind({ project, routerPath: '/router.ts', commands })
  );
}

function runFixture(subject, options) {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('/router.ts', FIXTURE_ROUTER);
  project.createSourceFile('/handler.ts', fixtureHandler(options));
  return runSystemControl(subject, project, FIXTURE_COMMANDS);
}

const keys = (result) => result.findings.map((f) => `${f.command}/${f.parameter}`).sort();

function selfTestSystemControl(subject) {
  const failures = [];

  // Planted: `enable` never copies `persist` (the #357 shape) and `disable` copies it into an
  // object its callee ignores (the `status` include_history shape). The error message and the
  // comment name `persist` — a name-based check would count those as reads.
  const planted = runFixture(subject, { persistOnEnable: false, offReads: false });
  const expected = ['demo:disable/persist', 'demo:enable/persist'];
  if (JSON.stringify(keys(planted)) !== JSON.stringify(expected)) {
    failures.push(
      `planted: expected ${expected.join(', ')}, got ${keys(planted).join(', ') || 'none'}`
    );
  }

  // Twin, differing only in those two reads: must be clean, and prove every read it found —
  // operation + reason + persist for enable and disable, operation + show_details for list.
  const fixed = runFixture(subject, { persistOnEnable: true, offReads: true });
  if (fixed.findings.length !== 0)
    failures.push(`fixed twin: expected none, got ${keys(fixed).join(', ')}`);
  if (fixed.verified !== 8)
    failures.push(`fixed twin: expected 8 proven reads, got ${fixed.verified}`);

  // A command whose operation has no case and no default is a finding, not a skip.
  const orphan = runSystemControl(
    subject,
    (() => {
      const project = new Project({ useInMemoryFileSystem: true });
      project.createSourceFile('/router.ts', FIXTURE_ROUTER);
      project.createSourceFile(
        '/handler.ts',
        fixtureHandler({ persistOnEnable: true, offReads: true }).replace(
          /default:\n\s*throw new Error\([^)]*\);/,
          ''
        )
      );
      return project;
    })(),
    [{ id: 'demo:missing', parameters: ['action', 'operation'] }]
  );
  if (orphan.findings.length !== 1 || orphan.findings[0].parameter !== 'operation') {
    failures.push(
      `orphan operation: expected one 'operation' finding, got ${keys(orphan).join(', ') || 'none'}`
    );
  }

  return failures.map((failure) => `system_control: ${failure}`);
}

/**
 * `used`: whether each destructured key's binding is used. The three shapes a key is destructured
 * in: off the argument object, under another name, and in a method's parameter list.
 */
function bindingFixture(subject, { used }) {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('/router.ts', FIXTURE_ROUTER);
  project.createSourceFile(
    '/handler.ts',
    `
export class DemoHandler {
  async execute(args: any) {
    switch (args.operation) {
      case 'local': {
        const { id } = args;
        return ${used ? 'id' : "'id is named here and used nowhere'"};
      }
      case 'renamed': {
        const { label: shown } = args;
        return ${used ? '{ shown }' : "'label'"};
      }
      case 'parameter':
        return this.show(args);
      default:
        throw new Error('unknown');
    }
  }
  private show({ detail }: any) {
    return ${used ? 'detail' : "'detail'"};
  }
}
`
  );
  return runSystemControl(subject, project, [
    { id: 'demo:local', parameters: ['action', 'operation', 'id'] },
    { id: 'demo:renamed', parameters: ['action', 'operation', 'label'] },
    { id: 'demo:parameter', parameters: ['action', 'operation', 'detail'] },
  ]);
}

function selfTestUnusedBindings(subject) {
  const failures = [];
  // Planted: each key is destructured and its binding never used — the `const { id } = args` blind
  // spot (#366). Destructuring alone reads nothing.
  const planted = bindingFixture(subject, { used: false });
  const expected = ['demo:local/id', 'demo:parameter/detail', 'demo:renamed/label'];
  if (JSON.stringify(keys(planted)) !== JSON.stringify(expected)) {
    failures.push(
      `planted: expected ${expected.join(', ')}, got ${keys(planted).join(', ') || 'none'}`
    );
  }
  // Twin, differing only in using each binding (a shorthand property counts as a use).
  const fixed = bindingFixture(subject, { used: true });
  if (fixed.findings.length !== 0) failures.push(`fixed twin: got ${keys(fixed).join(', ')}`);
  if (fixed.verified !== 6)
    failures.push(`fixed twin: expected 6 proven reads, got ${fixed.verified}`);
  return failures.map((failure) => `unused binding: ${failure}`);
}

/**
 * The reverse direction: a key the code reads that its command does not declare. `declared`:
 * whether each command declares what its code reads.
 */
function reverseFixture(subject, { declared }) {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('/ownership.ts', `export const PARAMETER_OWNERS = {};`);
  project.createSourceFile('/types.ts', `export const DESTRUCTIVE = new Set<string>(['remove']);`);
  project.createSourceFile(
    '/router.ts',
    `
import { DESTRUCTIVE } from './types.js';
const READ_ONLY = new Set<string>(['create']);
export class Router {
  private readonly demoHandler: DemoHandler;
  async handleAction(args: any) {
    const { action } = args;
    if (DESTRUCTIVE.has(action) && args.confirm !== true) throw new Error('confirm');
    // A refusal: it reads 'source' to refuse it, on every action outside READ_ONLY.
    if (args.source !== undefined && !READ_ONLY.has(action)) throw new Error('read-only');
    return this.routeToResource(args.resource_type, args);
  }
  private routeToResource(type: string, args: any) {
    switch (type) {
      case 'demo':
        return this.routeToDemo(args);
      default:
        throw new Error('unknown');
    }
  }
  private routeToDemo(args: any) {
    const demoArgs: any = { action: args.action, id: args.id };
    if (args.skip_version !== undefined) demoArgs.skipVersion = args.skip_version;
    if (args.patch !== undefined) demoArgs.patch = args.patch;
    return this.demoHandler.handleAction(demoArgs, {});
  }
}
`
  );
  project.createSourceFile(
    '/handler.ts',
    `
export class DemoHandler {
  private readonly lifecycle: DemoProcessor;
  async handleAction(args: any, _context: unknown) {
    switch (args.action) {
      case 'create':
        return this.lifecycle.handleCreate(args);
      case 'remove':
        return this.lifecycle.handleRemove(args);
      default:
        throw new Error('unknown');
    }
  }
}
export class DemoProcessor {
  handleCreate(args: any) {
    // A presence test refuses a key; it does not use it, so 'patch' needs no declaration here.
    if (args.patch !== undefined) throw new Error('patch is update-only');
    return [args.id, args.skipVersion === true];
  }
  handleRemove(args: any) {
    return args.id;
  }
}
`
  );
  return subject.checkBindings(
    subject.adapters.resourceManager.bind({
      project,
      routerPath: '/router.ts',
      commands: [
        {
          id: 'demo:create',
          parameters: ['resource_type', 'action', 'id', ...(declared ? ['skip_version'] : [])],
        },
        {
          id: 'common:remove',
          parameters: ['resource_type', 'action', 'id', ...(declared ? ['confirm'] : [])],
        },
      ],
    })
  );
}

/**
 * system_control's half: the `list` operation reads `limit`, which only `show` declares.
 * `noCase`: the handler hands every operation's arguments to one service call instead, so no read
 * belongs to an operation and nothing is attributed.
 */
function reverseSystemControlFixture(subject, { declared, noCase = false }) {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('/router.ts', FIXTURE_ROUTER);
  project.createSourceFile(
    '/handler.ts',
    noCase
      ? `
export class DemoHandler {
  private readonly service: unknown;
  async execute(args: any) {
    return run({ operation: args.operation, limit: args.limit });
  }
}
`
      : `
export class DemoHandler {
  async execute(args: any) {
    switch (args.operation) {
      case 'show':
      case 'list':
        return [args.limit];
      default:
        throw new Error('unknown');
    }
  }
}
`
  );
  return runSystemControl(subject, project, [
    { id: 'demo:show', parameters: ['action', 'operation', 'limit'] },
    { id: 'demo:list', parameters: ['action', 'operation', ...(declared ? ['limit'] : [])] },
  ]);
}

function selfTestReverse(subject) {
  const failures = [];
  // Planted: `create` reads `skip_version` (renamed `skipVersion` by the router) and the router's
  // destructive guard reads `confirm` on `remove`; neither command declares it. `source` is read
  // only to refuse it, which declares nothing. The system_control `list` operation falls through
  // to `show`'s case and reads `limit`, which only `show` declares.
  const planted = reverseFixture(subject, { declared: false });
  const expected = ['demo:create/skip_version', 'demo:remove/confirm'];
  if (JSON.stringify(keys(planted)) !== JSON.stringify(expected)) {
    failures.push(
      `planted: expected ${expected.join(', ')}, got ${keys(planted).join(', ') || 'none'}`
    );
  }
  const named = planted.findings.find((finding) => finding.parameter === 'confirm');
  if (named !== undefined && !named.reason.includes('Router.handleAction')) {
    failures.push(`planted: 'confirm' should name the router guard that reads it: ${named.reason}`);
  }
  const fixed = reverseFixture(subject, { declared: true });
  if (fixed.findings.length !== 0) failures.push(`fixed twin: got ${keys(fixed).join(', ')}`);
  if (fixed.verified !== 4)
    failures.push(`fixed twin: expected 4 proven reads, got ${fixed.verified}`);

  const plantedOperation = reverseSystemControlFixture(subject, { declared: false });
  if (JSON.stringify(keys(plantedOperation)) !== JSON.stringify(['demo:list/limit'])) {
    failures.push(
      `planted operation: expected demo:list/limit, got ${keys(plantedOperation).join(', ') || 'none'}`
    );
  }
  const fixedOperation = reverseSystemControlFixture(subject, { declared: true });
  if (fixedOperation.findings.length !== 0) {
    failures.push(`fixed operation twin: got ${keys(fixedOperation).join(', ')}`);
  }
  // The same undeclared `limit` with no per-operation case: not attributable, so not reported.
  const noCase = reverseSystemControlFixture(subject, { declared: false, noCase: true });
  if (noCase.findings.length !== 0) {
    failures.push(`no-case handler: expected none, got ${keys(noCase).join(', ')}`);
  }
  return failures.map((failure) => `reverse: ${failure}`);
}

/** `helperReads`: whether the helper reads `severity`. `routerCopies`: whether `reason` is copied. */
function resourceManagerFixture(subject, { helperReads, routerCopies }) {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile(
    '/ownership.ts',
    `export const PARAMETER_OWNERS = { severity: ['demo'], detail: ['other'] };`
  );
  project.createSourceFile(
    '/router.ts',
    `
function forwardOptionalValue(input: any, output: any): void {
  if (input.reason) {
    ${routerCopies ? 'output.reason = input.reason;' : 'void input.reason;'}
  }
}
export class Router {
  private readonly demoHandler: DemoHandler;
  async handleAction(args: any) {
    if (args.confirm !== true) throw new Error('confirm');
    this.log({ id: args.id, note: "'reason' is logged by name here" });
    return this.routeToResource(args.resource_type, args);
  }
  private routeToResource(type: string, args: any) {
    switch (type) {
      case 'demo':
        return this.routeToDemo(args);
      default:
        throw new Error('unknown');
    }
  }
  private routeToDemo(args: any) {
    const demoArgs: any = { action: args.action, id: args.id };
    demoArgs.note = "'reason' is spelled here, in a copied value, and copied nowhere";
    if (args.enforcement_mode) demoArgs.enforcementMode = args.enforcement_mode;
    if (args.severity) demoArgs.severity = args.severity;
    forwardOptionalValue(args, demoArgs);
    return this.demoHandler.handleAction(demoArgs, {});
  }
  private log(entry: unknown) { return entry; }
}
`
  );
  project.createSourceFile(
    '/handler.ts',
    `
export class DemoHandler {
  private readonly lifecycle: DemoProcessor;
  async handleAction(args: any, _context: unknown) {
    const action = args.action;
    switch (action) {
      case 'update':
        return this.lifecycle.handleUpdate(args);
      case 'inspect':
        return this.lifecycle.handleInspect(args);
      default:
        throw new Error("Unknown action. 'severity' is spelled like this.");
    }
  }
}
export class DemoProcessor {
  private readonly helper: DemoHelper;
  handleUpdate(args: any) {
    const { id } = args;
    this.note("'severity' is named here, on update, and read nowhere");
    return this.helper.apply(id, args);
  }
  handleInspect(args: any) {
    return args.id;
  }
  private note(message: string) { return message; }
}
export class DemoHelper {
  apply(id: string, input: any) {
    return [id, input.enforcementMode${helperReads ? ', input.severity, input.reason' : ''}];
  }
}
`
  );
  return subject.checkBindings(
    subject.adapters.resourceManager.bind({
      project,
      routerPath: '/router.ts',
      commands: [
        {
          id: 'demo:update',
          parameters: ['resource_type', 'action', 'id', 'severity', 'enforcement_mode', 'reason'],
        },
        {
          id: 'common:inspect',
          parameters: ['resource_type', 'action', 'id', 'detail', 'confirm'],
        },
      ],
    })
  );
}

function selfTestResourceManager(subject) {
  const failures = [];
  // Planted: the helper the processor hands `args` to never reads `severity` (named only in a
  // string, twice), and the router's local helper reads `reason` without writing the output.
  // A read or guard inside a no-op helper cannot prove forwarding. `detail` is
  // owned by another type, so `common:inspect` does not declare it for `demo`; `confirm` is the
  // router's own guard; `enforcement_mode` reaches the helper renamed as `enforcementMode`.
  const planted = resourceManagerFixture(subject, { helperReads: false, routerCopies: false });
  const expected = ['demo:update/reason', 'demo:update/severity'];
  if (JSON.stringify(keys(planted)) !== JSON.stringify(expected)) {
    failures.push(`planted: expected ${expected.join(', ')}, got ${keys(planted).join(', ')}`);
  }
  const dropped = planted.findings.find((finding) => finding.parameter === 'reason');
  if (dropped !== undefined && !dropped.reason.includes('dropped by Router.routeToDemo')) {
    failures.push(
      `planted: 'reason' should be reported as dropped by the router: ${dropped.reason}`
    );
  }
  // Twin, differing only in those two reads: clean, with every read proven — id, severity,
  // enforcement_mode, reason on update; id and confirm on inspect.
  const fixed = resourceManagerFixture(subject, { helperReads: true, routerCopies: true });
  if (fixed.findings.length !== 0) failures.push(`fixed twin: got ${keys(fixed).join(', ')}`);
  if (fixed.verified !== 6)
    failures.push(`fixed twin: expected 6 proven reads, got ${fixed.verified}`);
  return failures.map((failure) => `resource_manager: ${failure}`);
}

/**
 * `planted`: registration drops `inputs`, and no stage reads the `gates` request field.
 * `optionsUnused`: the stage destructures `options` off the request and never uses it.
 * `copiesUndeclared`: the registration copies `dry_run`, which the contract does not declare.
 */
function promptEngineFixture(
  subject,
  { planted, optionsUnused = false, copiesUndeclared = false }
) {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile(
    '/index.ts',
    `
export class Tools {
  private promptExecutor!: Executor;
  register(target: any) {
    target.registerTool('prompt_engine', {}, async (args: any, extra: unknown) => {
      const trimmedCommand = args.command?.trim();
      const normalizedArgs: any = {
        ...(trimmedCommand ? { command: trimmedCommand } : {}),
        ...(args.cancel !== undefined ? { cancel: args.cancel } : {}),
        ...(args.options != null ? { options: args.options } : {}),
        ${planted ? '' : '...(args.inputs != null ? { inputs: args.inputs } : {}),'}
        ${copiesUndeclared ? '...(args.dry_run ? { dry_run: args.dry_run } : {}),' : ''}
      };
      if (args.gates != null) {
        normalizedArgs.gates = args.gates.map((gate: unknown) => gate);
      }
      this.note("'inputs' is named here and copied nowhere");
      return this.promptExecutor.executePromptCommand(normalizedArgs, extra);
    });
  }
  private note(message: string) { return message; }
}
`
  );
  project.createSourceFile(
    '/executor.ts',
    `
export class Executor {
  async executePromptCommand(args: any, extra: any) {
    if (args.cancel === true) return this.handleCancel();
    const request = {
      ...(args.command && { command: args.command }),
      ...(args.options && { options: args.options }),
      ...(args.inputs && { inputs: args.inputs }),
      ...(args.gates !== undefined && { gates: args.gates }),
    } as any;
    return this.pipeline.execute(request, extra);
  }
  private handleCancel() { return 'cancelled'; }
}
`
  );
  project.createSourceFile(
    '/engine/stage.ts',
    `
export class Stage {
  execute(context: any) {
    const { options } = context.mcpRequest;
    return [context.mcpRequest.command, ${optionsUnused ? "'options'" : 'options'}, context.mcpRequest.inputs${
      planted ? ', context.state.gates, "\'gates\' is named here"' : ', context.mcpRequest.gates'
    }];
  }
}
`
  );
  return subject.checkBindings(
    subject.adapters.promptEngine.bind({
      project,
      routerPath: '/index.ts',
      commands: [],
      contract: {
        parameters: ['command', 'cancel', 'options', 'inputs', 'gates'].map((name) => ({ name })),
      },
      pipelinePath: '/engine',
    })
  );
}

function selfTestPromptEngine(subject) {
  const failures = [];
  // Planted: the registration allowlist never copies `inputs` (the hop `remainder`, `handoff` and
  // `claim_token` were each lost at), and `gates` reaches the pipeline request but no stage reads
  // it — the stage reads a `gates` off another object instead. Both are named in string literals.
  // `cancel` is consumed by the executor itself.
  const planted = promptEngineFixture(subject, { planted: true });
  const expected = ['call/gates', 'call/inputs'];
  if (JSON.stringify(keys(planted)) !== JSON.stringify(expected)) {
    failures.push(`planted: expected ${expected.join(', ')}, got ${keys(planted).join(', ')}`);
  }
  const fixed = promptEngineFixture(subject, { planted: false });
  if (fixed.findings.length !== 0) failures.push(`fixed twin: got ${keys(fixed).join(', ')}`);
  if (fixed.verified !== 5)
    failures.push(`fixed twin: expected 5 proven reads, got ${fixed.verified}`);
  // Planted: the only stage reading `options` destructures it off the request and never uses it.
  const unused = promptEngineFixture(subject, { planted: false, optionsUnused: true });
  if (JSON.stringify(keys(unused)) !== JSON.stringify(['call/options'])) {
    failures.push(
      `unused binding: expected call/options, got ${keys(unused).join(', ') || 'none'}`
    );
  }
  // Planted, the reverse direction: the registration copies `dry_run`, which no contract declares.
  const undeclared = promptEngineFixture(subject, { planted: false, copiesUndeclared: true });
  if (JSON.stringify(keys(undeclared)) !== JSON.stringify(['call/dry_run'])) {
    failures.push(`reverse: expected call/dry_run, got ${keys(undeclared).join(', ') || 'none'}`);
  }
  return failures.map((failure) => `prompt_engine: ${failure}`);
}

function selfTestExceptions(subject) {
  const entries = [
    { tool: 'demo', command: 'a:b', parameter: 'x' },
    { tool: 'demo', command: 'a:b', parameter: 'gone' },
    { tool: 'other', command: 'a:b', parameter: 'y' },
  ];
  const findings = [
    { command: 'a:b', parameter: 'x' },
    { command: 'a:b', parameter: 'y' },
  ];
  const result = subject.applyExceptions('demo', findings, entries);
  const shape = JSON.stringify([
    result.findings.map((f) => f.parameter),
    result.excused.map((f) => f.parameter),
    result.stale.map((e) => e.parameter),
  ]);
  return shape === JSON.stringify([['y'], ['x'], ['gone']])
    ? []
    : [`exceptions: an entry must excuse only its own tool's finding and go stale alone: ${shape}`];
}

export function selfTest(subject) {
  const failures = [
    ...selfTestExceptions(subject),
    ...selfTestSystemControl(subject),
    ...selfTestUnusedBindings(subject),
    ...selfTestReverse(subject),
    ...selfTestResourceManager(subject),
    ...selfTestPromptEngine(subject),
  ];
  for (const failure of failures) console.error(`❌ self-test: ${failure}`);
  if (failures.length === 0) console.log('[validate-tool-parameter-reads] self-test OK');
  return failures.length > 0 ? 1 : 0;
}

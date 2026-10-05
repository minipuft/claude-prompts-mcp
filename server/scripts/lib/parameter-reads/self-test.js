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
    ${routerCopies ? 'if (args.reason) demoArgs.reason = args.reason;' : ''}
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
  // string, twice), and the router never copies `reason` (named only in a log line). `detail` is
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

/** `planted`: registration drops `inputs`, and no stage reads the `gates` request field. */
function promptEngineFixture(subject, { planted }) {
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
    return [context.mcpRequest.command, options, context.mcpRequest.inputs${
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
    ...selfTestResourceManager(subject),
    ...selfTestPromptEngine(subject),
  ];
  for (const failure of failures) console.error(`❌ self-test: ${failure}`);
  if (failures.length === 0) console.log('[validate-tool-parameter-reads] self-test OK');
  return failures.length > 0 ? 1 : 0;
}

// @lifecycle test - Every cpm command that writes a resource is classified against what it records.
/**
 * The class, not the site.
 *
 * `cpm rollback` now records the state its write produced. The SHAPE of the defect it closed is
 * "a `cpm` command writes a resource file and no version row describes what the files became", and
 * that shape has more members than the one this slice fixed. This file enumerates them from the
 * command REGISTRY — `COMMANDS` in `cli/src/cli.ts`, resolved through the dispatch and the import
 * list to a module — so a new command that starts writing resources is a finding here rather than
 * an omission nobody notices.
 *
 * Each writing command must be in exactly one table below. `RECORDS_A_VERSION` is the closed half.
 * `HISTORY_HANDLED_WITHOUT_A_VERSION` is the half where recording one would be wrong, with the
 * reason. `CANNOT_RECORD_YET` is the open half, and every entry carries an as-of date and the
 * observation that flips it, because an unstamped `☐` disclaims work that may already have shipped.
 *
 * **Both polarities are checked.** A command in `CANNOT_RECORD_YET` that HAS started recording
 * fails here too — an exception whose condition no longer holds is a finding, not a pass.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../cli/src');

/**
 * Calling any of these from a command means that command WRITES A RESOURCE.
 *
 * Function names rather than `fs` verbs alone, because `cpm config` and `cpm enable` write a file
 * too and neither writes a resource — the question this file asks is about resource state, which
 * `version_history` records, not about every byte the CLI puts on disk.
 */
const RESOURCE_WRITERS = [
  'createResourceDir',
  'deleteResource',
  'deleteResourceDir',
  'renameResource',
  'movePromptCategory',
  'toggleEnabled',
  'linkGate',
  'initWorkspace',
  'serializeYamlPreservingSource',
];

/** Calling any of these means the command records a version row for what it produced. */
const VERSION_RECORDERS = [
  'rollbackVersion',
  'recordResourceWrite',
  'saveVersion',
  'recordEditResult',
];

/** The closed half: writes a resource AND records what the write produced. */
const RECORDS_A_VERSION = ['rollback', 'create', 'toggle'];

/**
 * Records for some resource types and, by measurement, cannot yet for others.
 *
 * A third table rather than a second entry in `CANNOT_RECORD_YET`, because a command cannot be in
 * two halves at once and collapsing the distinction loses the fact an operator needs: `cpm create
 * gate` writes a row and `cpm create prompt` does not. Each entry names the types still blocked
 * and is stamped like any other open marker.
 *
 * The check below is not "the entry exists": it reads `cli-shared/resource-snapshot.ts` and
 * requires the blocked type to still be absent from the projector table there, so lifting the
 * blocker without moving this entry fails here.
 */
const RECORDS_SOME_TYPES: Record<
  string,
  { blockedTypes: string[]; asOf: string; flipsWhen: string }
> = {
  create: {
    blockedTypes: ['prompt'],
    asOf: '2026-09-21',
    flipsWhen:
      'the prompt projection becomes reachable from `cli-shared` under the dev bundle budget — ' +
      'measured 2026-09-21 as a reachable import at +59.0 KB, which is 35.5 KB over the ' +
      '900,000-byte `DEV_BUNDLE_BUDGET_BYTES` and fails `npm run build` outright.',
  },
};

/** Writes a resource, and a version row would be wrong rather than missing. */
const HISTORY_HANDLED_WITHOUT_A_VERSION: Record<string, string> = {
  delete:
    'deleteResource purges the resource subtree from version_history — there is no state left ' +
    'for a row to describe.',
  rename:
    'renameHistoryResource re-keys the existing rows onto the new id. The bytes do not change, ' +
    'only the id field and the directory name, so a new row would record the state that is ' +
    'already the newest one.',
  move:
    "movePromptCategory changes the prompt's `category` field and moves its directory. Its " +
    'history key is its id, which a category move does not change (the function refuses an id ' +
    'containing a slash), so there is nothing to re-key and nothing new to record.',
  init: 'initWorkspace creates a workspace from nothing — there is no prior state to bridge.',
};

/**
 * Writes a resource, records nothing, and CANNOT until the prompt projection is reachable.
 *
 * The blocker moved, and this is what it is now. Until 2026-09-21 the reason was an IMPORT rule:
 * all four `SnapshotContract` implementations lived under `src/mcp/tools/**`, which `cli-shared/`
 * may not reach. That is fixed — gate, framework and category now project from
 * `modules/versioning/projections/`, which both surfaces import, and `cli-shared/
 * resource-snapshot.ts` is the CLI's entry to them.
 *
 * What remains is a BUDGET, measured rather than argued. A prompt snapshot is projected from a
 * loader-RESOLVED `ConvertedPrompt` — `userMessageTemplate` is the inlined body where `prompt.yaml`
 * holds only `userMessageTemplateFile` — so building one from the CLI needs `loadYamlPrompt` AND
 * `PromptConverter`. Measured as a reachable import on 2026-09-21: the `cpm` bundle went
 * 855.4 KB → 914.4 KB, **+59.0 KB**, which is 35.5 KB over the 900,000-byte
 * `DEV_BUNDLE_BUDGET_BYTES`, and `npm run build` fails outright. The budget was not raised.
 *
 * Writing a second, YAML-shaped prompt projection instead is the defect this slice exists to
 * remove: the bridge decision is `hashCanonical` equality, so a differently-shaped snapshot can
 * never compare equal and EVERY server edit of a `cpm`-written prompt would bridge.
 */
const CANNOT_RECORD_YET: Record<string, { asOf: string; flipsWhen: string }> = {
  // `link-gate` edits a PROMPT's `gateConfiguration`, so it is blocked by the prompt projection
  // and by nothing else: gates and frameworks already record through `cpm create` and
  // `cpm toggle`.
  'link-gate': {
    asOf: '2026-09-21',
    flipsWhen:
      'the prompt projection becomes reachable from `cli-shared` under the dev bundle budget — ' +
      'measured 2026-09-21 as a reachable import at +59.0 KB, which is 35.5 KB over the ' +
      '900,000-byte `DEV_BUNDLE_BUDGET_BYTES` and fails `npm run build` outright.',
  },
};

/** The registry, the dispatch and the import list — read, never restated. */
function commandModules(): Map<string, string> {
  const cli = readFileSync(path.join(CLI_SRC, 'cli.ts'), 'utf8');

  const registry = /const COMMANDS = \[([^\]]*)\] as const;/.exec(cli);
  if (registry === null) throw new Error('COMMANDS registry not found in cli/src/cli.ts');
  const names = [...registry[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!);

  const handlerModule = new Map<string, string>();
  for (const match of cli.matchAll(/import \{ ([^}]+) \} from '\.\/commands\/([\w-]+)\.js';/g)) {
    for (const symbol of match[1]!.split(',')) {
      handlerModule.set(symbol.trim(), match[2]!);
    }
  }

  const resolved = new Map<string, string>();
  for (const name of names) {
    const dispatched = new RegExp(`case '${name}':\\s*\\n\\s*exitCode = await (\\w+)\\(`).exec(cli);
    if (dispatched === null) throw new Error(`command '${name}' has no dispatch in cli.ts`);
    const module = handlerModule.get(dispatched[1]!);
    if (module === undefined) {
      throw new Error(`handler '${dispatched[1]!}' for '${name}' is not imported from ./commands/`);
    }
    resolved.set(name, module);
  }
  return resolved;
}

const calls = (source: string, names: string[]): string[] =>
  names.filter((name) => new RegExp(`(^|[^\\w.])${name}\\s*\\(`, 'm').test(source));

describe('every cpm command that writes a resource is classified against what it records', () => {
  const modules = commandModules();
  const sourceOf = new Map(
    [...new Set(modules.values())].map((module) => [
      module,
      readFileSync(path.join(CLI_SRC, 'commands', `${module}.ts`), 'utf8'),
    ])
  );

  it('resolves every registered command to a module — the control for the enumeration', () => {
    // An absence below is only evidence once this has been shown to find something. If the
    // registry, the dispatch or the import list changes shape, `commandModules()` throws above
    // rather than quietly resolving nothing and passing every assertion vacuously.
    expect(modules.size).toBeGreaterThanOrEqual(15);
    expect(modules.get('rollback')).toBe('rollback');
    expect(modules.get('enable')).toBe('enable-disable');
  });

  it('classifies every writing command, and only writing commands', () => {
    const unclassified: string[] = [];
    const misclassified: string[] = [];
    let writers = 0;

    for (const [name, module] of modules) {
      const source = sourceOf.get(module)!;
      const writes = calls(source, RESOURCE_WRITERS).length > 0;
      const classified =
        RECORDS_A_VERSION.includes(name) ||
        name in HISTORY_HANDLED_WITHOUT_A_VERSION ||
        name in CANNOT_RECORD_YET;

      if (writes) writers += 1;
      if (writes && !classified) {
        unclassified.push(`${name} (${module}.ts) writes a resource and is in no table`);
      }
      if (!writes && classified) {
        misclassified.push(`${name} (${module}.ts) is classified but writes no resource`);
      }
    }

    expect(writers).toBeGreaterThan(0);
    expect(unclassified).toEqual([]);
    // The reverse direction, so the tables cannot outlive what they describe: a command that
    // stops writing resources must leave its table rather than sit there as a satisfied exception.
    expect(misclassified).toEqual([]);
  });

  it('has every command in RECORDS_A_VERSION actually recording one', () => {
    for (const name of RECORDS_A_VERSION) {
      const source = sourceOf.get(modules.get(name)!)!;
      expect(calls(source, VERSION_RECORDERS).length).toBeGreaterThan(0);
    }
  });

  it('has every CANNOT_RECORD_YET entry still unable to — a satisfied exception is a finding', () => {
    const satisfied: string[] = [];
    for (const [name, marker] of Object.entries(CANNOT_RECORD_YET)) {
      // Both halves stamped: a `☐` with no as-of date and no falsifier is not actionable.
      expect(marker.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(marker.flipsWhen.length).toBeGreaterThan(30);

      const source = sourceOf.get(modules.get(name)!)!;
      if (calls(source, VERSION_RECORDERS).length > 0) {
        satisfied.push(`${name} now records a version — move it to RECORDS_A_VERSION`);
      }
    }
    expect(satisfied).toEqual([]);
  });

  it('has every RECORDS_SOME_TYPES entry still blocked on the types it names', () => {
    const projection = readFileSync(
      path.resolve(CLI_SRC, '..', '..', 'server', 'src', 'cli-shared', 'resource-snapshot.ts'),
      'utf8'
    );
    // `SHARED_PROJECTORS` is the SSOT for which types project through the server's contract. A
    // blocked type appearing as a key there means the exception is satisfied and the entry is now
    // a lie — a finding, not a pass.
    const projectorKeys = /const SHARED_PROJECTORS[\s\S]*?= \{([\s\S]*?)\n\};/.exec(projection);
    expect(projectorKeys).not.toBeNull();

    for (const [name, marker] of Object.entries(RECORDS_SOME_TYPES)) {
      expect(marker.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(marker.flipsWhen.length).toBeGreaterThan(30);
      expect(RECORDS_A_VERSION).toContain(name);

      for (const blocked of marker.blockedTypes) {
        expect(new RegExp(`^\\s{2}${blocked}:`, 'm').test(projectorKeys![1]!)).toBe(false);
      }
    }
    // The control: a type that IS projected is found by the same match, so a regex that stopped
    // matching anything could not report every blocked type as still blocked.
    expect(/^\s{2}gate:/m.test(projectorKeys![1]!)).toBe(true);
  });

  it('has cpm create name the created directory as its rollback target', () => {
    /**
     * The VALUE of `targets`, not the presence of the name.
     *
     * `targets` is what `ResourceMutationTransaction` restores when the version record fails, and
     * `expect(source).toMatch(/\btargets\b/)` is satisfied by ANY value — an empty array
     * included, which restores nothing and leaves a created-but-unrecorded resource behind.
     * Measured on this file's sibling row: the empty-array mutant stayed green under every
     * behavioural test here, because no test drives a record failure through the command itself.
     *
     * A create's target must be the resource DIRECTORY, captured as absent so restoring it means
     * removing it — and it must be `resolveResourceDir`'s answer, which
     * `tests/unit/cli-shared/resource-scaffold.test.ts` pins to the path the create actually uses.
     */
    const source = sourceOf.get(modules.get('create')!)!;
    expect(source).toContain("targets: [{ path: resourceDir, kind: 'directory' }]");
    expect(source).toContain('resolveCreatedResourceDir(baseDir, type, id, category)');
    // The control: the same search over a source that names `targets` with a different value does
    // NOT match, so the assertion is measuring the value and not the identifier.
    expect(`const x = { targets: [] };`).not.toContain(
      "targets: [{ path: resourceDir, kind: 'directory' }]"
    );
  });

  it('has cpm toggle name the entry FILE as its rollback target, not the directory', () => {
    // Same class as the create row above, and the same mutant stayed green: an empty `targets`
    // restores nothing when the record fails. The value matters twice here — `toggleEnabled`
    // rewrites `framework.yaml` alone, so a DIRECTORY target would also put back a
    // `system-prompt.md` this write never touched.
    const source = sourceOf.get(modules.get('toggle')!)!;
    expect(source).toContain("targets: [{ path: match.file, kind: 'file' }]");
    expect(source).not.toContain("kind: 'directory'");
  });

  it('detects a planted writer that records nothing — the probe sees something', () => {
    // The positive control for `calls()`, which every assertion above rests on. Two sources
    // differing in ONE identifier: the writer is present in both, the recorder in only one.
    const writesOnly = `import { linkGate } from '@cli-shared/index.js';\nlinkGate(file, id);\n`;
    const writesAndRecords = `${writesOnly}recordResourceWrite(dir, ref, input);\n`;

    expect(calls(writesOnly, RESOURCE_WRITERS)).toEqual(['linkGate']);
    expect(calls(writesOnly, VERSION_RECORDERS)).toEqual([]);
    expect(calls(writesAndRecords, VERSION_RECORDERS)).toEqual(['recordResourceWrite']);
    // An IMPORT is not a call: the name appearing in an import list must not answer for a call
    // site, or deleting the only call while leaving the import behind reads as coverage.
    expect(calls(`import { recordResourceWrite } from 'x';\n`, VERSION_RECORDERS)).toEqual([]);
  });
});

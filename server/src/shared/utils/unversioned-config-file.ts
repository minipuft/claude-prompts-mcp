// @lifecycle canonical - Refuses a config file with no "version" key, naming each pre-5.0 key it carries.
/**
 * A config file that declares no `version` is written in the pre-5.0 shape, and no reader accepts
 * it (ledger entry `config-file-unversioned`). The file is never translated and never rewritten:
 * the refusal lists every pre-5.0 key the file carries with what replaces it, then the line to add,
 * so the operator can correct the file from the message alone.
 *
 * One function, three callers: the server's config loader (prefixed `Refusing to start:`), `cpm`'s
 * config reader (`readConfigFile`), and config restore, which refuses to put a recorded pre-5.0
 * version back on disk. Everything here is pure; the tables are deleted with the ledger entry.
 *
 * The tables are the leaves `server/config.schema.json` declared before 5.0 and no longer declares
 * (measured against `git show 83196fcd:server/config.schema.json`), plus a `prompts.directory`
 * naming anything but the default, which a 5.0 file is refused for as well. Every other leaf is
 * spelled the same in both shapes.
 */

import path from 'node:path';

import { retirementNotice } from './retirement-notice.js';
import { DEFAULT_PROMPTS_CONFIG } from '../types/core-config.js';

/** A pre-5.0 key whose value lives under another key at 5.0. */
interface MovedKey {
  readonly from: string;
  readonly to: string;
  /** The pre-5.0 key held `"on"`/`"off"` where the 5.0 key holds a boolean. */
  readonly onOff: boolean;
}

/** A pre-5.0 key 5.0 has no place for, with what to do instead. */
interface RemovedKey {
  readonly key: string;
  /** Read when the message is composed, so ledger text is resolved at the refusal, not at import. */
  readonly instead: () => string;
  /** When present, the key is listed only for a value this returns true for. */
  readonly listedFor?: (value: unknown, configPath: string) => boolean;
}

/**
 * A `prompts.directory` naming the default says nothing and a 5.0 file may carry it; any other
 * value is refused in a 5.0 file too, so it is listed here and the operator fixes both at once.
 */
function namesOtherPromptsDirectory(value: unknown, configPath: string): boolean {
  if (typeof value !== 'string') return true;
  const dir = path.dirname(configPath);
  return path.resolve(dir, value) !== path.resolve(dir, DEFAULT_PROMPTS_CONFIG.directory);
}

const move = (from: string, to: string): MovedKey => ({ from, to, onOff: false });
const onOff = (from: string, to: string): MovedKey => ({ from, to, onOff: true });

const MOVED_KEYS: readonly MovedKey[] = [
  move('frameworks.systemPromptFrequency', 'frameworks.injection.systemPrompt.frequency'),
  move('frameworks.systemPromptTarget', 'frameworks.injection.systemPrompt.target'),
  move('frameworks.gateGuidanceFrequency', 'frameworks.injection.gateGuidance.frequency'),
  move('frameworks.gateGuidanceTarget', 'frameworks.injection.gateGuidance.target'),
  move('frameworks.styleGuidance', 'frameworks.injection.styleGuidance.enabled'),
  move('frameworks.styleGuidanceFrequency', 'frameworks.injection.styleGuidance.frequency'),
  move('frameworks.styleGuidanceTarget', 'frameworks.injection.styleGuidance.target'),
  move('advanced.sessions.timeoutMinutes', 'chainSessions.timeoutMinutes'),
  move('advanced.sessions.reviewTimeoutMinutes', 'chainSessions.reviewTimeoutMinutes'),
  move('advanced.sessions.cleanupIntervalMinutes', 'chainSessions.cleanupIntervalMinutes'),
  move('versioning.max_versions', 'versioning.maxVersions'),
  move('versioning.auto_version', 'versioning.autoVersion'),
  // `telemetry.mode`, `phaseGuards.mode` and `identity.mode` are live 5.0 keys and are absent here.
  onOff('gates.mode', 'gates.enabled'),
  onOff('frameworks.mode', 'frameworks.enabled'),
  onOff('resources.mode', 'resources.registerWithMcp'),
  onOff('resources.prompts.mode', 'resources.prompts.enabled'),
  onOff('resources.gates.mode', 'resources.gates.enabled'),
  onOff('resources.frameworks.mode', 'resources.frameworks.enabled'),
  onOff('resources.observability.mode', 'resources.observability.enabled'),
  onOff('resources.logs.mode', 'resources.logs.enabled'),
  onOff('verification.isolation.mode', 'verification.isolation.enabled'),
  onOff('versioning.mode', 'versioning.enabled'),
];

const NOTHING_REPLACES_IT = (): string => 'remove it; nothing reads it and nothing replaces it';

const REMOVED_KEYS: readonly RemovedKey[] = [
  { key: 'server.version', instead: () => 'remove it; the server reports its own version' },
  {
    key: 'server.transport',
    instead: () =>
      'remove it; stdio is the default, and another transport is chosen at launch with ' +
      retirementNotice('config-server-transport').replacement,
  },
  { key: 'gates.enforcePendingVerdict', instead: NOTHING_REPLACES_IT },
  { key: 'resources.prompts.defaultRegistration', instead: NOTHING_REPLACES_IT },
  {
    key: 'analysis',
    instead: () =>
      `remove the section; use ${retirementNotice('config-analysis-section').replacement}`,
  },
  {
    key: 'gates.directory',
    instead: () =>
      'remove it; gates are read from the gates/ folder of each location in "paths.resources"',
  },
  {
    key: 'prompts.directory',
    instead: () => `remove it; use ${retirementNotice('config-prompts-directory').replacement}`,
    listedFor: namesOtherPromptsDirectory,
  },
  {
    key: 'advanced',
    instead: () =>
      'remove the section; 5.0 has no "advanced" section, and chain session lifetimes live ' +
      'under "chainSessions"',
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The value at a dot-path, or `undefined` when any segment is missing or not an object. */
function readDotPath(root: Record<string, unknown>, key: string): { value: unknown } | undefined {
  let current: unknown = root;
  for (const segment of key.split('.')) {
    if (!isRecord(current) || !(segment in current)) return undefined;
    current = current[segment];
  }
  return { value: current };
}

function describeMovedKey(raw: Record<string, unknown>, moved: MovedKey, value: unknown): string {
  const prefix = `  - "${moved.from}"`;
  if (readDotPath(raw, moved.to) !== undefined) {
    return `${prefix}: remove it; "${moved.to}" is already set`;
  }
  if (!moved.onOff) return `${prefix}: move its value to "${moved.to}"`;
  if (value === 'on' || value === 'off') {
    return `${prefix}: ${JSON.stringify(value)} becomes "${moved.to}": ${String(value === 'on')}`;
  }
  return `${prefix}: replace it with "${moved.to}" set to true or false`;
}

function isListed(removed: RemovedKey, found: { value: unknown }, configPath: string): boolean {
  return removed.listedFor === undefined || removed.listedFor(found.value, configPath);
}

/** One line per pre-5.0 key `raw` carries, in table order: moved keys, then removed ones. */
function describePre5Keys(raw: Record<string, unknown>, configPath: string): string[] {
  const lines: string[] = [];
  for (const moved of MOVED_KEYS) {
    const found = readDotPath(raw, moved.from);
    if (found !== undefined) lines.push(describeMovedKey(raw, moved, found.value));
  }
  for (const removed of REMOVED_KEYS) {
    const found = readDotPath(raw, removed.key);
    if (found !== undefined && isListed(removed, found, configPath)) {
      lines.push(`  - "${removed.key}": ${removed.instead()}`);
    }
  }
  return lines;
}

/**
 * The refusal text for a parsed config document that declares no `version`, or `undefined` for one
 * that does (or for a document that is not an object, which its reader refuses on its own terms).
 *
 * The text names the file and is a complete sentence set without a prefix; the server places it
 * after `Refusing to start:`, and `cpm` prints it as is. A declared `version` other than `5` is
 * not refused here: the schema's `const 5` reports it.
 */
export function unversionedConfigFileRefusal(configPath: string, raw: unknown): string | undefined {
  if (!isRecord(raw) || raw['version'] !== undefined) return undefined;
  const notice = retirementNotice('config-file-unversioned');
  const opening = `${configPath} is ${notice.retired}, which is refused since ${notice.refusedIn}.`;
  const lines = describePre5Keys(raw, configPath);
  if (lines.length === 0) {
    return [`${opening} It carries no pre-5.0 key.`, `Add ${notice.replacement}.`].join('\n');
  }
  return [
    `${opening} Change each pre-5.0 key it carries:`,
    ...lines,
    `Then add ${notice.replacement}.`,
  ].join('\n');
}

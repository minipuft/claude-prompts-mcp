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

import * as retirementNotices from './_generated/retirement-notices.js';
import { DEFAULT_PROMPTS_CONFIG } from '../types/core-config.js';

/** A pre-5.0 key and the 5.0 key its value lives under. */
type MovedKey = readonly [from: string, to: string];

/**
 * A `prompts.directory` naming the default says nothing and a 5.0 file may carry it; any other
 * value is refused in a 5.0 file too, so it is listed here and the operator fixes both at once.
 */
function namesOtherPromptsDirectory(value: unknown, configPath: string): boolean {
  if (typeof value !== 'string') return true;
  const dir = path.dirname(configPath);
  return path.resolve(dir, value) !== path.resolve(dir, DEFAULT_PROMPTS_CONFIG.directory);
}

/** `frameworks.<guidance>Frequency` and `...Target` moved under `frameworks.injection.<guidance>`. */
const injectionMoves = (guidance: string): MovedKey[] =>
  ['Frequency', 'Target'].map((setting) => [
    `frameworks.${guidance}${setting}`,
    `frameworks.injection.${guidance}.${setting.toLowerCase()}`,
  ]);

/** `advanced.sessions.<lifetime>` became `chainSessions.<lifetime>`. */
const sessionMove = (lifetime: string): MovedKey => [
  `advanced.sessions.${lifetime}`,
  `chainSessions.${lifetime}`,
];

/**
 * Keys whose value moved as it is, in the order the refusal lists them. The renames follow a few
 * rules, so the table states each rule once over the names it applies to.
 */
const MOVED_KEYS: readonly MovedKey[] = [
  ...injectionMoves('systemPrompt'),
  ...injectionMoves('gateGuidance'),
  ['frameworks.styleGuidance', 'frameworks.injection.styleGuidance.enabled'],
  ...injectionMoves('styleGuidance'),
  ...['timeoutMinutes', 'reviewTimeoutMinutes', 'cleanupIntervalMinutes'].map(sessionMove),
  ['versioning.max_versions', 'versioning.maxVersions'],
  ['versioning.auto_version', 'versioning.autoVersion'],
];

/** An on/off `<section>.mode` became the boolean `<section>.enabled`. */
const modeToEnabled = (section: string): MovedKey => [`${section}.mode`, `${section}.enabled`];

/**
 * Keys that held `"on"`/`"off"` where the 5.0 key holds a boolean, listed after the moved keys.
 * `telemetry.mode`, `phaseGuards.mode` and `identity.mode` are live 5.0 keys and are absent here.
 */
const ON_OFF_KEYS: readonly MovedKey[] = [
  ...['gates', 'frameworks'].map(modeToEnabled),
  ['resources.mode', 'resources.registerWithMcp'],
  ...[
    'resources.prompts',
    'resources.gates',
    'resources.frameworks',
    'resources.observability',
    'resources.logs',
    'verification.isolation',
    'versioning',
  ].map(modeToEnabled),
];

const NOTHING_REPLACES_IT = 'remove it; nothing reads it and nothing replaces it';

/** Each pre-5.0 key 5.0 has no place for, with what to do instead, in the order listed. */
const REMOVED_KEYS: Readonly<Record<string, string>> = {
  'server.version': 'remove it; the server reports its own version',
  'server.transport':
    'remove it; stdio is the default, and another transport is chosen at launch with ' +
    retirementNotices.configServerTransport.replacement,
  'gates.enforcePendingVerdict': NOTHING_REPLACES_IT,
  'resources.prompts.defaultRegistration': NOTHING_REPLACES_IT,
  analysis: `remove the section; use ${retirementNotices.configAnalysisSection.replacement}`,
  'gates.directory':
    'remove it; gates are read from the gates/ folder of each location in "paths.resources"',
  'prompts.directory': `remove it; use ${retirementNotices.configPromptsDirectory.replacement}`,
  advanced:
    'remove the section; 5.0 has no "advanced" section, and chain session lifetimes live ' +
    'under "chainSessions"',
};

/** A removed key is listed whenever the file carries it, except a default `prompts.directory`. */
function isListed(key: string, value: unknown, configPath: string): boolean {
  return key !== 'prompts.directory' || namesOtherPromptsDirectory(value, configPath);
}

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

/** One moved key's line; `onOff` marks a key that held `"on"`/`"off"` for a 5.0 boolean. */
function describeMovedKey(
  raw: Record<string, unknown>,
  [from, to]: MovedKey,
  onOff: boolean,
  value: unknown
): string {
  const prefix = `  - "${from}"`;
  if (readDotPath(raw, to) !== undefined) {
    return `${prefix}: remove it; "${to}" is already set`;
  }
  if (!onOff) return `${prefix}: move its value to "${to}"`;
  if (value === 'on' || value === 'off') {
    return `${prefix}: ${JSON.stringify(value)} becomes "${to}": ${String(value === 'on')}`;
  }
  return `${prefix}: replace it with "${to}" set to true or false`;
}

/** One line per pre-5.0 key `raw` carries, in table order: moved, on/off, then removed keys. */
function describePre5Keys(raw: Record<string, unknown>, configPath: string): string[] {
  const lines: string[] = [];
  for (const [keys, onOff] of [
    [MOVED_KEYS, false],
    [ON_OFF_KEYS, true],
  ] as const) {
    for (const moved of keys) {
      const found = readDotPath(raw, moved[0]);
      if (found !== undefined) lines.push(describeMovedKey(raw, moved, onOff, found.value));
    }
  }
  for (const [key, instead] of Object.entries(REMOVED_KEYS)) {
    const found = readDotPath(raw, key);
    if (found !== undefined && isListed(key, found.value, configPath)) {
      lines.push(`  - "${key}": ${instead}`);
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
  const notice = retirementNotices.configFileUnversioned;
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

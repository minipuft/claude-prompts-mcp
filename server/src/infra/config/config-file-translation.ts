// @lifecycle canonical - Translates a 4.x config.json into the 5.0 file shape, in memory, on load.
/**
 * 4.x -> 5.0 config file translation.
 *
 * A pure function over the parsed file, keyed on `version` (ruling R33/R58): the operator takes no
 * action and the file on disk is never rewritten. `version` absent means the file was written
 * against the 4.x shape, which is the only shape that predates the key — so it is translated and
 * stamped `version: 5`. `version: 5` is already the current shape and is returned untouched. Any
 * OTHER value is also returned untouched: the schema's `const 5` is what reports it, and guessing
 * at a shape nobody has described would translate a file into something it never was.
 *
 * This replaces the unconditional spelling fold that ran on EVERY load, with no way to tell a 4.x
 * file from a 5.0 one — so it could never retire. Keying on `version` gives the translation the
 * retirement condition that fold lacked: it is removed in 6.0.0.
 *
 * The 22 keys below are exactly the leaves `server/config.schema.json` declared at 4.x and no
 * longer declares at 5.0 (measured against `git show 83196fcd:server/config.schema.json`). Every
 * other leaf is identical in both shapes and passes through untouched — including
 * `hooks.expandedOutput`, which the Python hooks read straight off the file.
 */

/** One 4.x dot-path folded into its 5.0 dot-path. Both are reported to the operator. */
export interface ConfigFileTranslatedKey {
  /** The 4.x dot-path the file carried. */
  from: string;
  /** The 5.0 dot-path its value now lives under. */
  to: string;
}

/** What {@link translateConfigFile} produced, and what it had to say about it. */
export interface ConfigFileTranslation {
  /** The file in the 5.0 shape. Never the object passed in — the input is not mutated. */
  file: Record<string, unknown>;
  /** Every key that moved, in table order. Empty for a file that was not translated. */
  translated: ReadonlyArray<ConfigFileTranslatedKey>;
  /** Every key 5.0 removed outright, as dot-paths. Empty for a file that was not translated. */
  dropped: readonly string[];
}

/**
 * How a 4.x value reaches its 5.0 key.
 *
 * `passthrough` carries the value unchanged. `onOff` is the inert `mode` spelling the 4.x CLI
 * wrote (`gates.mode: "on"`) while every runtime reader consulted the boolean beside it — the two
 * spellings never met, so the command reported success and changed nothing. Anything that is not
 * the literal `"on"`/`"off"` the CLI validated is DROPPED rather than guessed at: a wrong boolean
 * here silently flips a subsystem.
 */
type TranslationCoercion = 'passthrough' | 'onOff';

interface TranslationMove {
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly coerce: TranslationCoercion;
}

const MOVES: readonly TranslationMove[] = [
  // The seven flat `frameworks.*` injection keys the loader used to reassemble into three objects.
  {
    from: ['frameworks', 'systemPromptFrequency'],
    to: ['frameworks', 'injection', 'systemPrompt', 'frequency'],
    coerce: 'passthrough',
  },
  {
    from: ['frameworks', 'systemPromptTarget'],
    to: ['frameworks', 'injection', 'systemPrompt', 'target'],
    coerce: 'passthrough',
  },
  {
    from: ['frameworks', 'gateGuidanceFrequency'],
    to: ['frameworks', 'injection', 'gateGuidance', 'frequency'],
    coerce: 'passthrough',
  },
  {
    from: ['frameworks', 'gateGuidanceTarget'],
    to: ['frameworks', 'injection', 'gateGuidance', 'target'],
    coerce: 'passthrough',
  },
  {
    from: ['frameworks', 'styleGuidance'],
    to: ['frameworks', 'injection', 'styleGuidance', 'enabled'],
    coerce: 'passthrough',
  },
  {
    from: ['frameworks', 'styleGuidanceFrequency'],
    to: ['frameworks', 'injection', 'styleGuidance', 'frequency'],
    coerce: 'passthrough',
  },
  {
    from: ['frameworks', 'styleGuidanceTarget'],
    to: ['frameworks', 'injection', 'styleGuidance', 'target'],
    coerce: 'passthrough',
  },
  // `advanced` held exactly one member, so the wrapper named nothing; session lifetimes are an
  // operator-facing dial and sit at the file root at 5.0.
  {
    from: ['advanced', 'sessions', 'timeoutMinutes'],
    to: ['chainSessions', 'timeoutMinutes'],
    coerce: 'passthrough',
  },
  {
    from: ['advanced', 'sessions', 'reviewTimeoutMinutes'],
    to: ['chainSessions', 'reviewTimeoutMinutes'],
    coerce: 'passthrough',
  },
  {
    from: ['advanced', 'sessions', 'cleanupIntervalMinutes'],
    to: ['chainSessions', 'cleanupIntervalMinutes'],
    coerce: 'passthrough',
  },
  // The file surface flipped spelling at 5.0: the snake_case pair was the RUNTIME
  // (`VersioningConfig`) name that the 4.x file shape happened to share.
  {
    from: ['versioning', 'max_versions'],
    to: ['versioning', 'maxVersions'],
    coerce: 'passthrough',
  },
  {
    from: ['versioning', 'auto_version'],
    to: ['versioning', 'autoVersion'],
    coerce: 'passthrough',
  },
  // The inert `mode` spellings. The three modes a reader DOES consult (`telemetry.mode`,
  // `phaseGuards.mode`, `identity.mode`) are deliberately absent — folding those would destroy
  // live settings. `analysis.semanticAnalysis.llmIntegration.mode` is absent for a different
  // reason: the whole section is dropped below, so there is nothing to fold it into.
  { from: ['gates', 'mode'], to: ['gates', 'enabled'], coerce: 'onOff' },
  { from: ['frameworks', 'mode'], to: ['frameworks', 'enabled'], coerce: 'onOff' },
  // `resources` has no top-level `enabled` — `registerWithMcp` is that section's master switch.
  { from: ['resources', 'mode'], to: ['resources', 'registerWithMcp'], coerce: 'onOff' },
  {
    from: ['resources', 'prompts', 'mode'],
    to: ['resources', 'prompts', 'enabled'],
    coerce: 'onOff',
  },
  { from: ['resources', 'gates', 'mode'], to: ['resources', 'gates', 'enabled'], coerce: 'onOff' },
  {
    from: ['resources', 'frameworks', 'mode'],
    to: ['resources', 'frameworks', 'enabled'],
    coerce: 'onOff',
  },
  {
    from: ['resources', 'observability', 'mode'],
    to: ['resources', 'observability', 'enabled'],
    coerce: 'onOff',
  },
  { from: ['resources', 'logs', 'mode'], to: ['resources', 'logs', 'enabled'], coerce: 'onOff' },
  {
    from: ['verification', 'isolation', 'mode'],
    to: ['verification', 'isolation', 'enabled'],
    coerce: 'onOff',
  },
  { from: ['versioning', 'mode'], to: ['versioning', 'enabled'], coerce: 'onOff' },
];

/**
 * Keys 5.0 removed outright, with nothing to carry their value into.
 *
 * `server.version` was never an operator's choice (the server reports the package's own version);
 * `server.transport` is launch-time-only (ruling R30) and is REFUSED before this function runs
 * when it names anything but `"stdio"`, so what reaches here is the harmless spelling;
 * `gates.enforcePendingVerdict` and `resources.prompts.defaultRegistration` lost their readers;
 * `analysis` is the retired semantic-LLM sidecar.
 */
const DROPS: ReadonlyArray<readonly string[]> = [
  ['server', 'version'],
  ['server', 'transport'],
  ['gates', 'enforcePendingVerdict'],
  ['resources', 'prompts', 'defaultRegistration'],
  ['analysis'],
];

/** True for a plain JSON object — the only thing a dot-path may be walked through. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Walks `segments`, returning the containing object only if every segment is a live object. */
function resolveContainer(
  root: Record<string, unknown>,
  segments: readonly string[]
): Record<string, unknown> | undefined {
  let current: Record<string, unknown> = root;
  for (const segment of segments) {
    const next = current[segment];
    if (!isRecord(next)) return undefined;
    current = next;
  }
  return current;
}

/**
 * Walks `segments`, creating a plain object for any missing one.
 *
 * Returns `undefined` when an EXISTING segment holds something that is not an object: overwriting
 * it would destroy what the operator wrote, so the caller abandons that move and leaves the 4.x
 * key in place for the schema check to report.
 */
function ensureContainer(
  root: Record<string, unknown>,
  segments: readonly string[]
): Record<string, unknown> | undefined {
  let current: Record<string, unknown> = root;
  for (const segment of segments) {
    const next = current[segment];
    if (next === undefined) {
      const created: Record<string, unknown> = {};
      current[segment] = created;
      current = created;
      continue;
    }
    if (!isRecord(next)) return undefined;
    current = next;
  }
  return current;
}

/** Deletes `container[key]` when it holds nothing but an empty object. */
function pruneEmptyChild(container: Record<string, unknown>, key: string): void {
  const child = container[key];
  if (isRecord(child) && Object.keys(child).length === 0) delete container[key];
}

interface TranslationReport {
  translated: ConfigFileTranslatedKey[];
  dropped: string[];
}

/**
 * Applies one move, recording it.
 *
 * The canonical 5.0 key WINS when both spellings are present — an explicit 5.0 value is the newer
 * intent, and the 4.x one never reached a reader anyway. The move is still reported: what the
 * operator needs to know is that the 4.x spelling is no longer read and which key replaced it.
 */
function applyMove(
  file: Record<string, unknown>,
  move: TranslationMove,
  report: TranslationReport
): void {
  const sourceSegments = move.from.slice(0, -1);
  const sourceKey = move.from[move.from.length - 1] as string;
  const source = resolveContainer(file, sourceSegments);
  if (source === undefined || !(sourceKey in source)) return;

  const targetSegments = move.to.slice(0, -1);
  const targetKey = move.to[move.to.length - 1] as string;
  const target = ensureContainer(file, targetSegments);
  // A non-object sitting where the 5.0 container belongs: leave the file exactly as written and
  // let the schema check name both keys, rather than silently replacing one with the other.
  if (target === undefined) return;

  const rawValue = source[sourceKey];
  delete source[sourceKey];

  if (move.coerce === 'onOff' && rawValue !== 'on' && rawValue !== 'off') {
    report.dropped.push(move.from.join('.'));
    return;
  }

  if (!(targetKey in target) || target[targetKey] === undefined) {
    target[targetKey] = move.coerce === 'onOff' ? rawValue === 'on' : rawValue;
  }
  report.translated.push({ from: move.from.join('.'), to: move.to.join('.') });
}

/** Deletes one removed key, recording it. An absent key is not reported. */
function applyDrop(
  file: Record<string, unknown>,
  segments: readonly string[],
  report: TranslationReport
): void {
  const container = resolveContainer(file, segments.slice(0, -1));
  const key = segments[segments.length - 1] as string;
  if (container === undefined || !(key in container)) return;
  delete container[key];
  report.dropped.push(segments.join('.'));
}

/**
 * Removes the `advanced` wrapper once its three session keys have moved to the root.
 *
 * Unlike an emptied `server`, which stays as `{}` because 5.0 still HAS a `server` section,
 * `advanced` has no 5.0 counterpart at all. Anything still inside it after the moves is a key 5.0
 * cannot express, so it is reported as dropped rather than deleted in silence.
 */
function removeAdvanced(file: Record<string, unknown>, report: TranslationReport): void {
  const advanced = file['advanced'];
  if (advanced === undefined) return;
  if (isRecord(advanced)) {
    pruneEmptyChild(advanced, 'sessions');
    if (Object.keys(advanced).length === 0) {
      delete file['advanced'];
      return;
    }
  }
  delete file['advanced'];
  report.dropped.push('advanced');
}

/**
 * Translates a parsed config file into the 5.0 shape when — and only when — it declares no
 * `version`.
 *
 * Pure: `raw` is never mutated, and the returned `file` is always a fresh object.
 */
export function translateConfigFile(raw: Record<string, unknown>): ConfigFileTranslation {
  const file = structuredClone(raw);
  // A declared version is a file that already says which shape it is written in. `5` is current;
  // anything else is a shape this translation has no description of, and the schema's `const 5`
  // is what tells the operator so.
  if (raw['version'] !== undefined) return { file, translated: [], dropped: [] };

  const report: TranslationReport = { translated: [], dropped: [] };
  for (const move of MOVES) applyMove(file, move, report);
  for (const drop of DROPS) applyDrop(file, drop, report);
  removeAdvanced(file, report);
  file['version'] = 5;

  return { file, translated: report.translated, dropped: report.dropped };
}

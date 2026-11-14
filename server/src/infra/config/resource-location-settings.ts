// @lifecycle canonical - Refuses config-file resource-location settings the server cannot read as written.

import path from 'path';

import { DEFAULT_PROMPTS_CONFIG } from '#shared/types/core-config.js';
import { describeUnusableDirectory, PathSettingError } from '#shared/utils/path-setting.js';

/** The reserved `paths.resources` entry: the package's own resources, not a path. */
const BUNDLED_RESOURCES_ENTRY = 'bundled';

/**
 * One `paths.resources` entry as the runtime reads it: `"bundled"` kept as that literal, a path
 * resolved against the config file's directory (an absolute one stays itself). The refusals and
 * the runtime list both resolve through here, so a duplicate the refusal compares and a location
 * the resolver serves are the same string.
 */
export function resolveResourceLocation(entry: string, configPath: string): string {
  return entry === BUNDLED_RESOURCES_ENTRY ? entry : path.resolve(path.dirname(configPath), entry);
}

/**
 * `prompts.directory` for the readers that still consult it: the `prompts/` folder of the first
 * `paths.resources` entry that is a path, else the default.
 */
export function promptsDirectoryFromLocations(locations: readonly string[] | undefined): string {
  const first = locations?.find((entry) => entry !== BUNDLED_RESOURCES_ENTRY);
  return first === undefined ? DEFAULT_PROMPTS_CONFIG.directory : path.join(first, 'prompts');
}

/** How a refused config value reads in a refusal: its kind, and the value when it is short. */
function describeConfigValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'an object';
  return `a ${typeof value} (${JSON.stringify(value)})`;
}

/** Throws the startup refusal for one config-file setting, in the path-setting refusal's shape. */
export function refuseConfigSetting(configPath: string, problem: string, expected: string): never {
  throw new PathSettingError(
    [`Refusing to start: ${configPath} ${problem}.`, `Expected ${expected}.`].join('\n')
  );
}

/** True for a plain JSON object. */
export function isConfigObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Refuses a list entry that is not a non-empty string, that names a location an earlier entry
 * already named, or whose path is not an existing directory. Paths compare resolved against the
 * config file's directory, so `"lib"` and `"./lib"` are one location. A missing folder is a
 * refusal, not a skip: serving without it would read other resources than the ones listed.
 * `"bundled"` is never checked; the package ships it.
 */
function assertResourceLocationEntries(locations: readonly unknown[], configPath: string): void {
  const seen = new Map<string, string>();
  locations.forEach((entry, index) => {
    if (typeof entry !== 'string' || entry === '') {
      refuseConfigSetting(
        configPath,
        `sets "paths.resources[${index}]" to ${describeConfigValue(entry)}`,
        `a non-empty string there: "${BUNDLED_RESOURCES_ENTRY}" or a directory path`
      );
    }
    const location = resolveResourceLocation(entry, configPath);
    const earlier = seen.get(location);
    if (earlier !== undefined) {
      const spelling = earlier === entry ? '' : ` (also spelled ${JSON.stringify(earlier)})`;
      refuseConfigSetting(
        configPath,
        `lists ${JSON.stringify(entry)} in "paths.resources" more than once${spelling}`,
        'each location once in "paths.resources"'
      );
    }
    seen.set(location, entry);
  });
  // After the shape checks, so a malformed list is named as malformed before any path is probed.
  (locations as string[]).forEach((entry, index) => {
    const location = resolveResourceLocation(entry, configPath);
    const problem =
      location === BUNDLED_RESOURCES_ENTRY ? undefined : describeUnusableDirectory(location);
    if (problem !== undefined) {
      refuseConfigSetting(
        configPath,
        `lists ${JSON.stringify(entry)} in "paths.resources[${index}]", which resolves to ` +
          `${location}, and that path ${problem}`,
        `an existing directory there, or the entry removed from "paths.resources"`
      );
    }
  });
}

/** True when a removed `prompts.directory` value resolves to the default, so it says nothing. */
function namesDefaultPromptsDirectory(value: unknown, configPath: string): boolean {
  if (typeof value !== 'string') return false;
  const configDir = path.dirname(configPath);
  return (
    path.resolve(configDir, value) === path.resolve(configDir, DEFAULT_PROMPTS_CONFIG.directory)
  );
}

/**
 * The raw file without its `prompts.directory`, which {@link assertResourceLocationSettings} has
 * already proven names the default (amended ruling R3o: dropped silently). Never mutates `raw`.
 */
export function withoutPromptsDirectory(raw: Record<string, unknown>): Record<string, unknown> {
  const prompts = raw['prompts'];
  if (!isConfigObject(prompts) || !('directory' in prompts)) return raw;
  const rest: Record<string, unknown> = { ...prompts };
  delete rest['directory'];
  return { ...raw, prompts: rest };
}

/**
 * Refuses a `paths.writeTarget` that names no folder a write may land in: not a non-empty string,
 * `"bundled"` (the package's own resources are never written), a path that resolves to neither a
 * `paths.resources` entry nor the profile's own resources folder, or one that is not an existing
 * directory. The refusal lists the folders the key may name, so the fix is in the message.
 */
function assertWriteTarget(
  paths: Record<string, unknown>,
  configPath: string,
  profileResourcesDir: string | undefined
): void {
  if (!('writeTarget' in paths)) return;
  const value = paths['writeTarget'];
  const listed = Array.isArray(paths['resources']) ? (paths['resources'] as string[]) : [];
  const allowed = listed
    .filter((entry) => entry !== BUNDLED_RESOURCES_ENTRY)
    .map((entry) => resolveResourceLocation(entry, configPath));
  if (profileResourcesDir !== undefined && !allowed.includes(profileResourcesDir)) {
    allowed.push(profileResourcesDir);
  }
  const expected =
    allowed.length === 0
      ? 'the key removed: no folder may be named until "paths.resources" lists one'
      : `one of these folders there: ${allowed.join(', ')}`;

  if (typeof value !== 'string' || value === '') {
    refuseConfigSetting(
      configPath,
      `sets "paths.writeTarget" to ${describeConfigValue(value)}`,
      expected
    );
  }
  if (value === BUNDLED_RESOURCES_ENTRY) {
    refuseConfigSetting(
      configPath,
      `sets "paths.writeTarget" to "${BUNDLED_RESOURCES_ENTRY}", and the package's own resources are never written`,
      expected
    );
  }
  const target = path.resolve(path.dirname(configPath), value);
  if (!allowed.includes(target)) {
    refuseConfigSetting(
      configPath,
      `sets "paths.writeTarget" to ${JSON.stringify(value)}, which resolves to ${target}, a ` +
        'folder neither "paths.resources" nor the profile names',
      expected
    );
  }
  const problem = describeUnusableDirectory(target);
  if (problem !== undefined) {
    refuseConfigSetting(
      configPath,
      `sets "paths.writeTarget" to ${JSON.stringify(value)}, which resolves to ${target}, and ` +
        `that path ${problem}`,
      `an existing directory there, or the key removed`
    );
  }
}

/**
 * Refuses a raw parsed config file whose resource locations cannot be read as written: a
 * `prompts.directory` naming anything but the default (removed, amended ruling R3o), a `paths`
 * that is not an object, a `paths.resources` that is not a non-empty list of distinct
 * non-empty strings, or a `paths.writeTarget` naming no folder a write may land in.
 *
 * Runs against the RAW record, before `translateConfigFile`, like `assertServerTransportIsStdio`
 * in `index.ts`, so a 4.x file is held to the same rule.
 */
export function assertResourceLocationSettings(
  rawConfig: Record<string, unknown>,
  configPath: string,
  profileResourcesDir: string | undefined
): void {
  const prompts = rawConfig['prompts'];
  if (
    isConfigObject(prompts) &&
    'directory' in prompts &&
    !namesDefaultPromptsDirectory(prompts['directory'], configPath)
  ) {
    refuseConfigSetting(
      configPath,
      `sets "prompts.directory" to ${describeConfigValue(prompts['directory'])}, which is no longer read`,
      'the resources directory that holds its prompts/ folder listed under "paths.resources" ' +
        `instead, an ordered list in which "${BUNDLED_RESOURCES_ENTRY}" names the package's own ` +
        'resources, or remove "prompts.directory" to use the default'
    );
  }

  const paths = rawConfig['paths'];
  if (paths === undefined) return;
  if (!isConfigObject(paths)) {
    refuseConfigSetting(
      configPath,
      `sets "paths" to ${describeConfigValue(paths)}`,
      `an object there, such as { "resources": ["./my-resources", "${BUNDLED_RESOURCES_ENTRY}"] }`
    );
  }

  const locations = paths['resources'];
  if (locations !== undefined) assertResourceLocationList(locations, configPath);
  assertWriteTarget(paths, configPath, profileResourcesDir);
}

/** Refuses a `paths.resources` that is not a non-empty list of distinct, existing locations. */
function assertResourceLocationList(locations: unknown, configPath: string): void {
  if (!Array.isArray(locations)) {
    refuseConfigSetting(
      configPath,
      `sets "paths.resources" to ${describeConfigValue(locations)}`,
      `a list of strings there, such as ["./my-resources", "${BUNDLED_RESOURCES_ENTRY}"]`
    );
  }
  if (locations.length === 0) {
    refuseConfigSetting(
      configPath,
      'sets "paths.resources" to an empty list, which names no location',
      `the key omitted, or a list naming at least "${BUNDLED_RESOURCES_ENTRY}"`
    );
  }
  assertResourceLocationEntries(locations, configPath);
}

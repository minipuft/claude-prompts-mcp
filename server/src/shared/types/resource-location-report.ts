// @lifecycle canonical - What `system_control` may say about where resources come from (Layer 0).
/**
 * The read-only view `config get paths.resources` and `status` render the resource locations from.
 *
 * WHY A PORT. Which folders serve a type, and in what order, has one derivation —
 * `PathResolver.getResourceLocations` in `runtime/` — and `mcp/` may not import `runtime/`
 * (`.dependency-cruiser.cjs`, `no-imports-into-runtime`). The composition root builds the view
 * from the resolver (`runtime/resource-location-report.ts`) and hands it to the handlers, the same
 * shape `skillsSyncPaths` takes. Nothing here re-derives an order.
 *
 * The view lives on the process-wide tools manager, never on a registered `McpServer`, so STDIO
 * (one server per connection) and Streamable HTTP (one per request) read the same answer.
 */

/** Why a folder is in the list: `PathResolver`'s own four kinds. */
export type ResourceLocationKind = 'project' | 'profile' | 'listed' | 'bundled';

/** The four directory-form kinds the resource index walks. */
export type ReportedResourceKind = 'prompt' | 'gate' | 'framework' | 'style';

/** One `paths.resources` entry, absolute, in the file's order, with `"bundled"` as the package folder. */
export interface ConfiguredLocationEntry {
  path: string;
  kind: 'listed' | 'bundled';
  /** The setting that put it there, in `getResourceLocations`'s own words (`paths.resources[0]`). */
  source: string;
}

/** One location in precedence order, with what each kind serves from it. */
export interface ReportedLocation {
  /** The folder the type directories sit in (`<entry>` for `<entry>/prompts`). */
  path: string;
  kind: ResourceLocationKind;
  /** Served definitions per kind: rows of the resource index whose file sits under this location. */
  counts: Record<ReportedResourceKind, number>;
}

/**
 * Where the package's own folder stands: `listed` (a `paths.resources` list names `"bundled"`),
 * `implicit` (no list, so it serves last), `absent` (a list leaves it out, R3c).
 */
export type BundleState = 'listed' | 'implicit' | 'absent';

/**
 * What a `workspaces.jsonc` registry beside the workspace's parent says about the current
 * workspace. Read only to report a label; the server never resolves one (R3g).
 */
export type ProfileRegistryReading =
  | { state: 'none' }
  | { state: 'labelled'; label: string; siblings: string[]; registryPath: string }
  | { state: 'unlabelled'; labels: string[]; registryPath: string }
  | { state: 'unreadable'; registryPath: string; reason: string };

/** A definition hidden by a same-id definition in an earlier location. */
export interface ShadowedEntry {
  type: ReportedResourceKind;
  id: string;
  /** The definition file that serves. */
  servedFrom: string;
  /** The definition file the earlier one hides. */
  hiddenIn: string;
}

/**
 * A resource file on disk that its loader refused, read from the loaders' own quarantine.
 *
 * The previous definition of that id, if there was one, is still the one served; this entry is
 * how an operator who edited the file learns the edit did not take effect, and why.
 */
export interface RefusedFileEntry {
  type: ReportedResourceKind;
  id: string;
  path: string;
  /** The loader's reason. Diagnostic text only, never the file's content. */
  reason: string;
  /** ISO 8601 time the file was first refused for this reason; absent when the loader did not say. */
  since?: string;
}

/** Everything `status` reports under **Resource locations**. */
export interface ResourceLocationReport {
  /** Highest precedence first, as the prompt type's location list orders them. */
  locations: ReportedLocation[];
  bundled: BundleState;
  profile: ProfileRegistryReading;
  /** Every same-id pair of the most recent index sync, served side first. */
  shadowed: ShadowedEntry[];
  /** Every file a loader refuses right now, read live rather than from the latest sync. */
  refused: RefusedFileEntry[];
}

/** The port the composition root wires into `system_control`. */
export interface ResourceLocationsView {
  /** The `paths.resources` list in force; empty when the config names none. */
  configuredEntries(): ConfiguredLocationEntry[];
  report(): ResourceLocationReport;
}

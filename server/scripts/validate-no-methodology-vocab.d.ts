/**
 * Hand-written declarations for the scope half of `validate-no-methodology-vocab.js`.
 *
 * Only `inScopeFiles` is exported, and only so the scope rules can be tested without a repository.
 * The scan, the allowlist audit and the exit codes stay behind `main()`.
 *
 * `scripts/**` is outside both tsconfigs, so the runtime never needs this file — the Jest suite
 * does, since `tsconfig.test.json` includes `tests/**` and would otherwise report an untyped
 * import. Same arrangement as `lib/exception-hygiene.d.ts`.
 */

/**
 * Filters a list of repo-relative git-tracked paths down to the ones this gate may search.
 *
 * Pure: the caller supplies the tracked set, so nothing here touches the filesystem or git.
 */
export declare function inScopeFiles(tracked: readonly string[]): string[];

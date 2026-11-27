/** Hand-written declarations for `tracked-scope.js`, which stays plain JS for the gates written in JS. */

export declare function trackedFilesUnder(prefixes: string[], options?: { cwd?: string }): string[];

export declare function assertNonEmptyScope(
  files: string[],
  prefixes: string[],
  gateName: string
): void;

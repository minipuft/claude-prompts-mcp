// @lifecycle canonical - Unit tests for the author-supplied environment denylist.
/**
 * Author Environment Denylist
 *
 * Row 1.6 of the 2026-08-24 security review. `MCP_SHELL_VERIFY_ALLOWLIST` bounds the
 * command STRING a gate may run; these keys decide what that string RESOLVES to. The
 * suite's job is to prove the refusal fires on the resolution-affecting keys and does
 * NOT fire on ordinary ones — an over-broad denylist would push operators to
 * `UNSAFE_ALLOW_ALL`, which ruling R7 names as strictly worse.
 */

import {
  buildSafeEnvironment,
  findUnsafeEnvironmentKeys,
  UnsafeEnvironmentKeyError,
} from '../../../../src/shared/utils/process.js';

describe('findUnsafeEnvironmentKeys', () => {
  describe('refuses keys that redirect resolution or load code', () => {
    it.each([
      ['PATH', 'decides which binary an allowed command name resolves to'],
      ['BASH_ENV', 'sourced by bash at non-interactive startup'],
      ['ENV', 'sourced by sh at startup'],
      ['IFS', 'changes how sh -c splits the command it was handed'],
      ['SHELLOPTS', 'applies shell options before the command runs'],
      ['BASHOPTS', 'applies shell options before the command runs'],
      ['NODE_OPTIONS', '--require loads arbitrary modules'],
      ['PYTHONPATH', 'module search path'],
      ['PYTHONHOME', 'interpreter root'],
      ['PYTHONSTARTUP', 'executed before the script'],
      ['PERL5LIB', 'module search path'],
      ['PERL5OPT', '-M requires arbitrary modules'],
      ['RUBYLIB', 'module search path'],
      ['RUBYOPT', 'applies options before the script runs'],
      ['LD_PRELOAD', 'ELF loader preload'],
      ['LD_LIBRARY_PATH', 'ELF loader search path'],
      ['LD_AUDIT', 'ELF loader audit hook — covered by the LD_ prefix, not enumerated'],
      ['DYLD_INSERT_LIBRARIES', 'macOS loader preload'],
    ])('%s (%s)', (key) => {
      expect(findUnsafeEnvironmentKeys({ [key]: 'x' })).toEqual([key]);
    });

    it('matches regardless of case, because a shell reads PATH however it is spelled', () => {
      expect(findUnsafeEnvironmentKeys({ path: '/tmp/evil' })).toEqual(['path']);
      expect(findUnsafeEnvironmentKeys({ Ld_Preload: '/tmp/x.so' })).toEqual(['Ld_Preload']);
    });

    it('reports every offending key, not just the first', () => {
      const found = findUnsafeEnvironmentKeys({ PATH: '/a', LD_PRELOAD: '/b', SAFE: 'c' });
      expect(found.sort()).toEqual(['LD_PRELOAD', 'PATH']);
    });

    it('scans every supplied map, since maps are merged before the spawn', () => {
      expect(findUnsafeEnvironmentKeys({ SAFE: 'a' }, { PATH: '/evil' })).toEqual(['PATH']);
    });
  });

  describe('permits ordinary variables — the negatives are what keep the dial usable', () => {
    it.each([
      'CI',
      'NODE_ENV',
      'PYTHONUNBUFFERED',
      'PYTHONDONTWRITEBYTECODE',
      'VIRTUAL_ENV',
      'LANG',
      'HOME',
      'SCRIPT_TOOL_ID',
      'MY_PROJECT_TOKEN',
      'LDAP_URL',
    ])('%s', (key) => {
      expect(findUnsafeEnvironmentKeys({ [key]: 'x' })).toEqual([]);
    });

    it('handles undefined and empty maps', () => {
      expect(findUnsafeEnvironmentKeys(undefined, {})).toEqual([]);
    });
  });
});

describe('buildSafeEnvironment', () => {
  it('throws rather than silently stripping, so a refused spawn cannot read as a failed one', () => {
    expect(() => buildSafeEnvironment(undefined, { PATH: '/tmp/evil' })).toThrow(
      UnsafeEnvironmentKeyError
    );
    expect(() => buildSafeEnvironment(undefined, { LD_PRELOAD: '/tmp/x.so' })).toThrow(
      UnsafeEnvironmentKeyError
    );
  });

  it('names the offending keys in the message', () => {
    expect(() => buildSafeEnvironment(undefined, { NODE_OPTIONS: '--require /tmp/x' })).toThrow(
      /NODE_OPTIONS/
    );
  });

  // The asymmetry, pinned. `baseEnv` is the CONSTRUCTING operator's configuration, not
  // content; screening it would deny an embedder the right to pin the PATH its own
  // interpreters resolve on, which three integration tests already exercise.
  it("does not screen baseEnv, which carries the operator's own configuration", () => {
    const env = buildSafeEnvironment({ PATH: '/operator/bin' });
    expect(env['PATH']).toBe('/operator/bin');
  });

  // POSITIVE CONTROL. Every assertion above is a refusal, so on its own the suite would
  // still pass against a function that refused everything. This proves the permissive
  // path is reachable and that an ordinary author variable still arrives at the child.
  it('still builds an environment when the author map is ordinary', () => {
    const env = buildSafeEnvironment({ MY_FLAG: '1' }, { OTHER: '2' });
    expect(env['MY_FLAG']).toBe('1');
    expect(env['OTHER']).toBe('2');
  });

  it('still inherits PATH from the parent when nobody overrides it', () => {
    const env = buildSafeEnvironment(undefined, { MY_FLAG: '1' });
    expect(env['PATH']).toBe(process.env['PATH']);
  });
});

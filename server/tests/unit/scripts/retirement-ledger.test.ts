/**
 * The retirement ledger's shape is checked when the scripts load it: each planted malformed
 * document is refused with the entry and the field named, and a well-formed one parses. The
 * runtime projection the product reads holds exactly the ledger's entries, one member per id,
 * each carrying the entry's own text.
 */
import { describe, expect, it } from '@jest/globals';

import { listRetirements, parseRetirementLedger } from '../../../scripts/lib/retirement-ledger.js';
import { isProjected, projectionMember } from '../../../scripts/lib/retirement-projection.js';
import * as retirementNotices from '../../../src/shared/utils/_generated/retirement-notices.js';

const VALID = {
  id: 'planted-entry',
  kind: 'config-key',
  retired: 'old.key',
  replacement: 'new.key',
  refusedIn: '6.0.0',
  forgetAfter: '2027-06-01',
  docPattern: 'old\\.key',
};

function refusal(entry: Record<string, unknown>): string {
  try {
    parseRetirementLedger({ retirements: [entry] });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('a malformed entry was accepted');
}

describe('retirement ledger shape', () => {
  it('parses a well-formed entry (control for every refusal below)', () => {
    expect(parseRetirementLedger({ retirements: [VALID] })).toEqual([VALID]);
  });

  it.each([
    ['an unknown kind', { kind: 'environment' }, 'kind must be one of'],
    ['a non-kebab id', { id: 'Planted_Entry' }, 'id must be kebab-case'],
    ['a refusedIn that is not a release', { refusedIn: '6.0' }, 'refusedIn must be a release'],
    ['a date that names no day', { forgetAfter: '2027-02-30' }, 'forgetAfter must be an ISO'],
    ['a docPattern that does not compile', { docPattern: '(' }, 'docPattern must be a regular'],
    ['a null docPattern with no reason', { docPattern: null }, 'docPatternReason must say why'],
    ['a field the ledger does not have', { note: 'x' }, 'note is not a ledger field'],
    ['an empty replacement', { replacement: ' ' }, 'replacement must be non-empty'],
    ['empty refusalSites', { refusalSites: [] }, 'refusalSites must be a non-empty array'],
    ['a refusal site that is not an object', { refusalSites: ['a.py'] }, 'refusalSites[0] must'],
    [
      'a refusal site outside the repository',
      { refusalSites: [{ file: '../a.py', marker: 'refused' }] },
      'refusalSites[0].file must be a path relative to the repository root',
    ],
    [
      'an absolute refusal site',
      { refusalSites: [{ file: '/a.py', marker: 'refused' }] },
      'refusalSites[0].file must be a path relative to the repository root',
    ],
    [
      'a refusal site with no marker',
      { refusalSites: [{ file: 'a.py' }] },
      'refusalSites[0].marker must be one non-empty line',
    ],
    [
      'a marker of two lines',
      { refusalSites: [{ file: 'a.py', marker: 'one\ntwo' }] },
      'refusalSites[0].marker must be one non-empty line',
    ],
    [
      'a refusal site field the ledger does not have',
      { refusalSites: [{ file: 'a.py', marker: 'refused', line: 3 }] },
      'refusalSites[0].line is not a refusal site field',
    ],
  ])('refuses %s, naming the entry and the field', (_case, change, expected) => {
    const message = refusal({ ...VALID, ...change });

    expect(message).toContain('retirements[0]');
    expect(message).toContain(expected);
  });

  it('refuses a duplicate id', () => {
    expect(() => parseRetirementLedger({ retirements: [VALID, VALID] })).toThrow(
      'retirements[1] (planted-entry): id is used by an earlier entry'
    );
  });

  it('accepts a null docPattern that carries its reason', () => {
    const entry = { ...VALID, docPattern: null, docPatternReason: 'the spelling is a bare word' };

    expect(parseRetirementLedger({ retirements: [entry] })).toEqual([entry]);
  });

  it('accepts an entry whose refusal sites are declared files with markers', () => {
    const entry = {
      ...VALID,
      kind: 'prompt-argument',
      refusalSites: [{ file: 'server/resources/a/script.py', marker: 'is not an argument' }],
    };

    expect(parseRetirementLedger({ retirements: [entry] })).toEqual([entry]);
  });
});

describe('the runtime projection', () => {
  it('holds one member per entry refused in TypeScript and nothing else', () => {
    const declared = listRetirements().filter((entry) => !isProjected(entry));

    // Control: the ledger holds entries refused outside TypeScript, which must be left out.
    expect(declared.length).toBeGreaterThan(0);
    expect(Object.keys(retirementNotices).sort()).toEqual(
      listRetirements()
        .filter(isProjected)
        .map((entry) => projectionMember(entry.id))
        .sort()
    );
  });

  it("carries each entry's retired spelling, replacement and refusing release", () => {
    const members: Record<string, unknown> = retirementNotices;
    for (const entry of listRetirements().filter(isProjected)) {
      expect(members[projectionMember(entry.id)]).toEqual({
        retired: entry.retired,
        replacement: entry.replacement,
        refusedIn: entry.refusedIn,
      });
    }
  });
});

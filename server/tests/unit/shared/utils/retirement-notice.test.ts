/**
 * The retirement ledger's shape is checked when it loads: each planted malformed document is
 * refused with the entry and the field named, a well-formed one parses, and an id with no entry
 * throws instead of producing half a sentence.
 */
import { describe, expect, it } from '@jest/globals';

import {
  listRetirements,
  parseRetirementLedger,
  retirementNotice,
} from '../../../../src/shared/utils/retirement-notice.js';

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
});

describe('retirementNotice', () => {
  it('returns the retired spelling, its replacement and the refusing release of an entry', () => {
    const entry = listRetirements()[0];
    if (entry === undefined) throw new Error('the shipped ledger is empty');

    expect(retirementNotice(entry.id)).toEqual({
      retired: entry.retired,
      replacement: entry.replacement,
      refusedIn: entry.refusedIn,
    });
  });

  it('throws for an id the ledger does not hold', () => {
    expect(() => retirementNotice('no-such-entry')).toThrow(
      "retirementNotice: retirements.json has no entry 'no-such-entry'"
    );
  });
});

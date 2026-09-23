/**
 * A step answer that clears the CAGEERF phase guards the bundled framework declares.
 *
 * A gated chain step is graded on the section headers its gate review showed it (P4.115), so an
 * e2e that drives a gate with a one-line answer also trips the phase guard, whose findings then
 * join the gate's review (R103). A suite testing the GATE alone answers with this, so the only
 * thing its verdict is judged on is the gate. `body` is carried verbatim into the first section,
 * for markers.
 */
export function cageerfAnswer(body: string): string {
  const pad = (text: string): string =>
    `${text} Stated at length so each section clears its phase guard minimum by real prose rather than by a stub sentence.`;
  return [
    '## Context',
    pad(body),
    '## Analysis',
    pad('The options differ in cost, operability and fit for the stated need.'),
    '## Goals',
    pad('Name a choice the reader can act on and the reason it wins.'),
    '## Execution',
    pad('List the options, weigh them, and pick one.'),
    '## Evaluation',
    pad('The answer covers the ask.'),
    '## Refinement',
    pad('Tighten the wording on the next pass.'),
  ].join('\n\n');
}

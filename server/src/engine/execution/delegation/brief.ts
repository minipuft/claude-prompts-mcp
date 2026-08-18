// @lifecycle canonical - Section builders for the self-contained delegation brief (R-1).
/**
 * The brief is the delegation contract: everything a spawned executor needs, rendered as text in
 * the SAME response as the delegated step (R-1, delegation plan implementation notes §Rulings).
 * Text is the only channel by design — the executor has no `mcp__` tools, so the chain resume
 * token never leaves the parent; these builders produce worker-facing sections the operator
 * embeds between {@link BRIEF_START} / {@link BRIEF_END}.
 *
 * Pure functions over plain data: `delegation/` is a rendering module and takes no pipeline
 * imports.
 */

const BRIEF_DELIMITER = '═'.repeat(65);

export const BRIEF_START = `${BRIEF_DELIMITER}\nEXECUTION BRIEF (sub-agent prompt — pass everything between these delimiters)\n${BRIEF_DELIMITER}`;
export const BRIEF_END = `${BRIEF_DELIMITER}\nEND EXECUTION BRIEF\n${BRIEF_DELIMITER}`;

/**
 * `### Quality Gates` is load-bearing, not decoration: `hooks/lib/ralph_subagent_contract.py`
 * scans worker transcripts for exactly this heading (S2 — the Python module API is the published
 * contract, so the TS side emits the heading the hook already requires). Renaming it breaks the
 * subagent gate-enforcement contract.
 */
export const QUALITY_GATES_HEADING = '### Quality Gates';

/**
 * Gate section for the brief. Uses the PER-STEP gate text stage 11 already writes
 * (`step.metadata['gateInstructions']`) — S4's whole fix is reading the per-step field instead
 * of the run-scoped one that is never assigned for chains.
 *
 * Rendered independently of the gate-guidance injection toggle: the toggle governs inline
 * guidance verbosity for the parent, while this section is the delegation contract the worker
 * reviews against (R-2). A step with no gate text gets no section.
 */
export function buildQualityGatesSection(gateInstructions: string | undefined): string | null {
  if (gateInstructions === undefined || gateInstructions.trim().length === 0) {
    return null;
  }
  return `${QUALITY_GATES_HEADING}\n\n${gateInstructions.trim()}`;
}

/** One prior step's captured output, as the history section consumes it. */
export interface BriefHistoryEntry {
  readonly stepNumber: number;
  readonly stepName: string;
  readonly output: string;
}

/**
 * Chain-history section (S1): outputs of the steps BEFORE the previous one. The previous step's
 * output is not repeated here — it already reaches the worker through the rendered template's
 * `{{previous_step_output}}`, and `chain_history` / `previous_step_output` are distinct
 * {@link VisibilityItem}s precisely so an author can withhold one without the other.
 *
 * Caller applies the P5 visibility decision BEFORE calling (withheld history = do not call);
 * this builder only formats what the policy admitted.
 */
export function buildChainHistorySection(entries: readonly BriefHistoryEntry[]): string | null {
  if (entries.length === 0) {
    return null;
  }
  const parts = ['### Chain History (prior step outputs)'];
  for (const entry of entries) {
    parts.push('', `#### Step ${entry.stepNumber}: ${entry.stepName}`, '', entry.output.trim());
  }
  return parts.join('\n');
}

/**
 * Result contract (R-2 — worker proposes, parent ratifies). The worker returns its work product
 * plus, when gates exist, a `Proposed Gate Review` block in the same per-gate shape as
 * `gate_verdict.per_gate`. It is labelled PROPOSED because the worker's verdict is never
 * authoritative: the parent reviews against the same criteria, may override any entry, and is
 * the only party that submits `gate_verdict` — the worker cannot (no MCP tools), which is what
 * keeps judgment with the parent structurally rather than by convention.
 */
export function buildResultContractSection(hasGates: boolean): string {
  const parts = [
    '### Result Contract',
    '',
    'Return your complete work product as plain text — it becomes the chain’s step output verbatim.',
  ];
  if (hasGates) {
    parts.push(
      '',
      'Then append a proposed self-review — PROPOSED only; the orchestrating agent reviews and may override before submitting the actual verdict:',
      '',
      '```',
      'Proposed Gate Review:',
      '- [gate 1 name]: PASS|FAIL — <one-line rationale>',
      '- [gate 2 name]: PASS|FAIL — <one-line rationale>',
      '```'
    );
  }
  return parts.join('\n');
}

/**
 * Withheld-context manifest line for the brief (names only, never values — P5 OQ-P5-3).
 * Same wording as the envelope renderer used, so hooks or readers keying on the phrase see one
 * spelling.
 */
export function buildWithheldManifestLine(manifest: readonly string[]): string | null {
  if (manifest.length === 0) {
    return null;
  }
  return `CONTEXT WITHHELD (names only, values not provided): ${manifest.join(', ')}`;
}

/** Inputs for {@link assembleBriefBody}; the caller applies visibility BEFORE building these. */
export interface BriefBodyInputs {
  /** Already-rendered worker-facing sections (intent, framework, system message, template). */
  readonly workerLines: readonly string[];
  /** The delegated step's OWN gate text (stage 11's per-step field) — S4. */
  readonly stepGateText: string | undefined;
  /** Visibility-admitted prior outputs — empty when `chain_history` is withheld (S1). */
  readonly historyEntries: readonly BriefHistoryEntry[];
  /** Withheld item names for the manifest line. */
  readonly manifest: readonly string[];
}

/**
 * Compose the full worker-facing brief body: worker lines, then history, gates, manifest, and
 * the result contract. Section ORDER is part of the contract — the result contract closes the
 * brief so the worker's last instruction is what to return.
 */
export function assembleBriefBody(inputs: BriefBodyInputs): string {
  const parts: string[] = [...inputs.workerLines];

  const history = buildChainHistorySection(inputs.historyEntries);
  if (history !== null) parts.push(history);

  const gates = buildQualityGatesSection(inputs.stepGateText);
  if (gates !== null) parts.push(gates);

  const manifestLine = buildWithheldManifestLine(inputs.manifest);
  if (manifestLine !== null) parts.push(manifestLine);

  parts.push(buildResultContractSection(gates !== null));
  return parts.filter(Boolean).join('\n\n');
}

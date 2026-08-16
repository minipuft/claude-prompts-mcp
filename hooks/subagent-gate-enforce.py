#!/usr/bin/env python3
"""
SubagentStop hook: Enforce gate verdicts on delegated sub-agents.

Reads the sub-agent's transcript JSONL to find gate criteria from the
context envelope (### Quality Gates) and checks the final response for
a GATE_REVIEW verdict. Blocks completion if verdict is missing or FAIL.

Data flow:
  Context envelope in Task prompt -> agent executes -> SubagentStop fires
  -> this hook reads transcript -> finds gates? -> checks verdict -> block/allow
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "lib"))
from ralph_subagent_contract import (
    extract_quality_gates,
    has_original_intent,
    is_ralph_protocol_prompt,
    parse_criterion_verdicts,
    parse_gate_review,
    parse_memory_update,
)


def log(msg: str) -> None:
    """Print to stderr for --debug visibility."""
    print(f"[subagent-gate-enforce] {msg}", file=sys.stderr)


def parse_hook_input() -> dict:
    """Parse JSON input from Claude Code hook system."""
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError:
        return {}


def read_transcript(path: str) -> list[dict]:
    """Read JSONL transcript file into list of message dicts.

    Graceful on missing/corrupt files — returns empty list.
    """
    messages = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    messages.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        return []
    return messages


def find_initial_prompt(transcript: list[dict]) -> str:
    """Extract the first human message text (the Task tool prompt).

    The context envelope with gate criteria is embedded here.
    """
    for msg in transcript:
        role = msg.get("type") or msg.get("role", "")
        if role == "human":
            # Content may be string or list of content blocks
            content = msg.get("content", "")
            if isinstance(content, list):
                parts = []
                for block in content:
                    if isinstance(block, dict):
                        parts.append(block.get("text", ""))
                    elif isinstance(block, str):
                        parts.append(block)
                return "\n".join(parts)
            return str(content)
    return ""


def find_verdict(transcript: list[dict]) -> tuple[str, str] | None:
    """Scan assistant messages backward for GATE_REVIEW verdict.

    Returns (verdict, rationale) tuple or None if no verdict found.
    Matches: GATE_REVIEW: PASS/FAIL followed by em-dash, en-dash, hyphen, or colon.
    """
    # Scan from end — last verdict wins
    for msg in reversed(transcript):
        role = msg.get("type") or msg.get("role", "")
        if role != "assistant":
            continue

        content = msg.get("content", "")
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, dict):
                    parts.append(block.get("text", ""))
                elif isinstance(block, str):
                    parts.append(block)
            content = "\n".join(parts)

        verdict = parse_gate_review(str(content))
        if verdict:
            return verdict

    return None


def find_memory_update(transcript: list[dict]) -> str | None:
    """Scan assistant messages backward for MEMORY_UPDATE acknowledgment."""
    for msg in reversed(transcript):
        role = msg.get("type") or msg.get("role", "")
        if role != "assistant":
            continue

        content = msg.get("content", "")
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, dict):
                    parts.append(block.get("text", ""))
                elif isinstance(block, str):
                    parts.append(block)
            content = "\n".join(parts)

        summary = parse_memory_update(str(content))
        if summary:
            return summary

    return None


def main():
    hook_input = parse_hook_input()

    # Guard: prevent infinite blocking loop
    if hook_input.get("stop_hook_active"):
        log("stop_hook_active=true, allowing to prevent loop")
        sys.exit(0)

    # Guard: no transcript path means nothing to inspect
    transcript_path = hook_input.get("agent_transcript_path")
    if not transcript_path:
        log("no agent_transcript_path, allowing")
        sys.exit(0)

    # Read the transcript
    transcript = read_transcript(transcript_path)
    if not transcript:
        log(f"transcript empty or unreadable: {transcript_path}")
        sys.exit(0)

    # Find the initial prompt (Task tool's prompt parameter)
    prompt_text = find_initial_prompt(transcript)
    if not prompt_text:
        log("no initial prompt found in transcript")
        sys.exit(0)

    # Check for gate criteria in context envelope
    criteria = extract_quality_gates(prompt_text)
    ralph_protocol = is_ralph_protocol_prompt(prompt_text)
    if not criteria and not ralph_protocol:
        log("no Quality Gates or Ralph protocol in prompt, allowing")
        sys.exit(0)

    # Gates or Ralph protocol exist — check for verdict
    verdict_result = find_verdict(transcript)

    if verdict_result is None:
        # No verdict emitted — block
        log("enforced prompt found but no GATE_REVIEW verdict emitted")
        required_criteria = criteria if criteria else "- Emit gate verdict and memory update for Ralph protocol."
        response = {
            "decision": "block",
            "reason": (
                "## Gate Verdict Missing\n\n"
                "Quality checks were specified but no GATE_REVIEW verdict was emitted.\n\n"
                f"**Required criteria**:\n{required_criteria}\n\n"
                "Evaluate your work against each criterion and respond with:\n"
                "`GATE_REVIEW: PASS \u2014 [rationale]` or `GATE_REVIEW: FAIL \u2014 [rationale]`"
            ),
        }
        print(json.dumps(response))
        sys.exit(0)

    verdict, rationale = verdict_result

    if verdict == "FAIL":
        # FAIL verdict — block with feedback
        log(f"GATE_REVIEW: FAIL — {rationale}")
        response = {
            "decision": "block",
            "reason": (
                "## Gate Review Failed\n\n"
                f"Your self-review returned FAIL: {rationale}\n\n"
                f"**Gate criteria**:\n{criteria}\n\n"
                "Address the failing criteria and emit a new verdict:\n"
                "`GATE_REVIEW: PASS \u2014 [rationale]`"
            ),
        }
        print(json.dumps(response))
        sys.exit(0)

    if ralph_protocol:
        memory_update = find_memory_update(transcript)
        if memory_update is None:
            log("ralph protocol prompt missing MEMORY_UPDATE acknowledgment")
            response = {
                "decision": "block",
                "reason": (
                    "## Memory Update Missing\n\n"
                    "Ralph session protocol requires a memory update acknowledgment.\n\n"
                    "Add a line in your response:\n"
                    "`MEMORY_UPDATE: [what you wrote to run-memory.md]`\n\n"
                    "Then re-emit your verdict:\n"
                    "`GATE_REVIEW: PASS — [rationale]`"
                ),
            }
            print(json.dumps(response))
            sys.exit(0)

    # Check for criterion coverage when Original Request Intent was in the prompt
    if has_original_intent(prompt_text):
        # Scan last assistant message for criterion verdicts
        for msg in reversed(transcript):
            role = msg.get("type") or msg.get("role", "")
            if role != "assistant":
                continue
            msg_content = msg.get("content", "")
            if isinstance(msg_content, list):
                msg_content = "\n".join(
                    block.get("text", "") if isinstance(block, dict) else str(block) for block in msg_content
                )
            criterion_results = parse_criterion_verdicts(str(msg_content))
            if criterion_results is None:
                log("advisory: Original Request Intent present but no CRITERION_VERDICTS block")
            break

    # PASS verdict — allow completion and clear delegation state
    log(f"GATE_REVIEW: PASS — {rationale}")
    session_id = hook_input.get("session_id", "")
    if session_id:
        try:
            from session_state import clear_delegation_state

            clear_delegation_state(session_id)
        except ImportError:
            pass  # session_state not available — skip cleanup
    sys.exit(0)


if __name__ == "__main__":
    main()

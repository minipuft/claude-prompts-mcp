#!/usr/bin/env python3
"""Tests for showcase-contracts.py (row 9.9): run as `env -u CLAUDE_PLUGIN_ROOT python3 media/showcase/scripts/animation/hooks/test_showcase_contracts.py`.

The hook runs the real probes, so the scratch showcase root holds a copy of the real scripts (a symlinked script breaks `node`'s main-module check), the real v3 through symlinks and its own copy of v3/proposals, the one directory a test writes into. The planted
proposals are written by a real shell heredoc, and the transcript the hook reads records that same command.
"""
import json, os, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

HOOK = Path(__file__).with_name("showcase-contracts.py")
REAL = Path(__file__).resolve().parents[3]
BAD_VOCAB = {"id": "p900", "kind": "finding", "from": "planner", "date": "2026-10-19", "anchor": {"beat": "arrival", "frame": 10}, "title": "a malformed proposal", "text": "intent: vibey", "intent": "vibey",
             "references": [], "before": "x", "after": "y", "status": "open", "ruling": None}
BAD_BIBLE = {**BAD_VOCAB, "id": "p901", "text": "carries no intent word; the bible has no item for this file"}
del BAD_BIBLE["intent"]


def scratch_root(tmp):
    root = Path(tmp) / "media" / "showcase"; (root / "v3").mkdir(parents=True); (root / "out").mkdir()
    shutil.copytree(REAL / "scripts", root / "scripts", ignore=shutil.ignore_patterns("__pycache__")); os.symlink(REAL / "out" / "bible.html", root / "out" / "bible.html")
    for e in (REAL / "v3").iterdir():
        if e.name != "proposals": os.symlink(e, root / "v3" / e.name)
    shutil.copytree(REAL / "v3" / "proposals", root / "v3" / "proposals")
    return root


def transcript(path, turns):
    """turns: [(user text, [tool calls])]; a tool call is ('Bash', command) or ('Write', file_path) or ('Read', file_path)."""
    rows = []
    for text, calls in turns:
        rows.append({"type": "user", "message": {"role": "user", "content": text}})
        for name, arg in calls:
            inp = {"command": arg} if name == "Bash" else {"file_path": arg}
            rows.append({"type": "assistant", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": name, "input": inp}]}})
            rows.append({"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "ok"}]}})
    Path(path).write_text("\n".join(json.dumps(r) for r in rows) + "\n")


def run_hook(root, tp, **extra):
    env = {k: v for k, v in os.environ.items() if k != "CLAUDE_PLUGIN_ROOT"}; env["SHOWCASE_CONTRACTS_ROOT"] = str(root)
    r = subprocess.run([sys.executable, str(HOOK)], input=json.dumps({"hook_event_name": "Stop", "transcript_path": str(tp), "cwd": str(root.parents[1]), **extra}), capture_output=True, text=True, env=env, timeout=300)
    return r.returncode, r.stdout


def heredoc(root, name, body):
    cmd = f"cat > media/showcase/v3/proposals/{name} <<'EOF'\n{json.dumps(body)}\nEOF"
    subprocess.run(["bash", "-c", cmd], cwd=root.parents[1], check=True)
    return cmd


class ShowcaseContractsHook(unittest.TestCase):
    def setUp(self): self.tmp = tempfile.mkdtemp(); self.root = scratch_root(self.tmp); self.tp = Path(self.tmp) / "t.jsonl"
    def tearDown(self): shutil.rmtree(self.tmp, ignore_errors=True)

    def test_silent_on_a_turn_that_wrote_nothing_under_v3(self):
        transcript(self.tp, [("look at the screenplay", [("Read", str(self.root / "v3" / "screenplay.json")), ("Bash", "rg -n sp-4.2 media/showcase/v3/screenplay.json")])])
        code, out = run_hook(self.root, self.tp); self.assertEqual((code, out), (0, ""))

    def test_silent_when_the_turn_wrote_under_v3_and_every_probe_passes(self):
        cmd = "cat > media/showcase/v3/studies/note.md <<'EOF'\nnothing a probe reads\nEOF"
        transcript(self.tp, [("note it", [("Bash", cmd)])]); code, out = run_hook(self.root, self.tp); self.assertEqual((code, out), (0, ""))

    def test_blocks_on_a_malformed_proposal_written_through_a_bash_heredoc(self):
        cmd = heredoc(self.root, "p900-malformed.json", BAD_VOCAB); transcript(self.tp, [("file the proposal", [("Bash", cmd)])])
        code, out = run_hook(self.root, self.tp); body = json.loads(out)
        self.assertEqual(code, 0); self.assertEqual(body["decision"], "block")
        self.assertIn("probe-vocabulary refuses", body["reason"]); self.assertIn("p900 intent 'vibey'", body["reason"]); print("\nBLOCK (vocabulary):", body["reason"].splitlines()[0])

    def test_blocks_on_a_proposal_the_bible_does_not_carry(self):
        cmd = heredoc(self.root, "p901-malformed.json", BAD_BIBLE); transcript(self.tp, [("file the proposal", [("Bash", cmd)])])
        code, out = run_hook(self.root, self.tp); body = json.loads(out)
        self.assertEqual(body["decision"], "block"); self.assertIn("probe-bible refuses", body["reason"]); self.assertIn("p901 has a file and no item in the bible", body["reason"]); print("\nBLOCK (bible):", body["reason"].splitlines()[0])

    def test_blocks_on_a_write_tool_call_under_v3(self):
        heredoc(self.root, "p901-malformed.json", BAD_BIBLE); transcript(self.tp, [("file the proposal", [("Write", str(REAL / "v3" / "proposals" / "p901-malformed.json"))])])
        code, out = run_hook(self.root, self.tp); self.assertEqual(json.loads(out)["decision"], "block")

    def test_loop_guard_stays_silent_when_it_already_blocked_this_turn(self):
        cmd = heredoc(self.root, "p900-malformed.json", BAD_VOCAB); transcript(self.tp, [("file the proposal", [("Bash", cmd)])])
        self.assertEqual(run_hook(self.root, self.tp, stop_hook_active=True), (0, ""))

    def test_a_write_in_an_earlier_turn_is_not_this_turns(self):
        cmd = heredoc(self.root, "p900-malformed.json", BAD_VOCAB); transcript(self.tp, [("file the proposal", [("Bash", cmd)]), ("thanks, now read the plan", [("Read", "plans/animation-scaffold-2026-10-14.md")])])
        self.assertEqual(run_hook(self.root, self.tp), (0, ""))

    def test_the_planted_file_is_the_cause_not_the_probes(self):
        # positive control for the silent cases: the same scratch root, the same transcript, the planted file removed -> silent
        cmd = heredoc(self.root, "p900-malformed.json", BAD_VOCAB); transcript(self.tp, [("file the proposal", [("Bash", cmd)])])
        self.assertEqual(json.loads(run_hook(self.root, self.tp)[1])["decision"], "block")
        (self.root / "v3" / "proposals" / "p900-malformed.json").unlink(); self.assertEqual(run_hook(self.root, self.tp), (0, ""))


if __name__ == "__main__":
    unittest.main(verbosity=2)

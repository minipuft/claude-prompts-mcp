"""
P6.206 / R106: the hook's `::` criterion pattern agrees with the server's gate grammar.

`detect_inline_gates` in prompt-suggest.py matches a quoted criterion with `[^"']+`, so it can
never extract a criterion holding a quote character. That is right, not a gap: the server's
grammar (`operators.json`, the gate pattern) delimits the text with the same class and has no
escape, and `parseCommand` refuses a criterion holding a quote by name (P6.196), in both the
symbolic and the JSON command forms. So a quoted criterion never reaches a run the hook would
describe. These tests pin both halves of that agreement.
"""

import importlib.util
import json
import sys
from pathlib import Path

HOOKS_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(HOOKS_DIR))
sys.path.insert(0, str(HOOKS_DIR / "lib"))

_spec = importlib.util.spec_from_file_location("prompt_suggest", HOOKS_DIR / "prompt-suggest.py")
prompt_suggest = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(prompt_suggest)

OPERATORS_JSON = HOOKS_DIR.parent / "server" / "tooling" / "contracts" / "registries" / "operators.json"
QUOTED_TEXT_CLASS = "[^\"']+"


def _server_gate_pattern() -> str:
    registry = json.loads(OPERATORS_JSON.read_text(encoding="utf-8"))
    operators = registry.get("operators", registry)
    entries = operators if isinstance(operators, list) else list(operators.values())
    gate = next(o for o in entries if isinstance(o, dict) and o.get("id") == "gate")
    return gate["pattern"]["typescript"]


def test_hook_and_server_delimit_quoted_text_with_one_class():
    """The server's quoted forms and the hook's both exclude exactly `"` and `'`."""
    server = _server_gate_pattern()
    assert server.count(QUOTED_TEXT_CLASS) == 2  # anonymous and named quoted forms
    hook_source = (HOOKS_DIR / "prompt-suggest.py").read_text(encoding="utf-8")
    assert "quoted_pattern = r'::\\s*[\\'\"]([^\\'\"]+)[\\'\"]'" in hook_source


def test_positive_control_an_unquoted_or_plain_quoted_criterion_is_extracted():
    assert prompt_suggest.detect_inline_gates('>>analyze :: "cite sources"') == ["cite sources"]
    assert prompt_suggest.detect_inline_gates(">>analyze :: 'cite sources'") == ["cite sources"]
    assert prompt_suggest.detect_inline_gates(">>analyze :: security-check") == ["security-check"]


def test_a_criterion_holding_a_quote_is_never_extracted_whole():
    """The server refuses `:: "it's fine"`; the hook cannot yield it either."""
    for message in ['>>analyze :: "it\'s fine"', '>>analyze :: tone:"say "hi" first"']:
        extracted = prompt_suggest.detect_inline_gates(message)
        assert all('"' not in c and "'" not in c for c in extracted), extracted
        assert "it's fine" not in extracted

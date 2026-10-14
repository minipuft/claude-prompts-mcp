"""
Parity between projected vocabularies and the TypeScript source that owns them.

WHY THIS FILE EXISTS
--------------------
The hooks cannot import the server's TypeScript, so each vocabulary below is a second statement of a
fact the server declares. A change on one side alone still passes that side's own tests, which each
restate the literal again, so nothing observed the two drifting apart.

Each check reads the TypeScript SOURCE FILE (never a build) and compares it with the value the
Python module holds at import time. The comparison is a pure function of (TypeScript text, Python
value), so a positive control can hand it a planted copy of the TypeScript text and show it fails
by name, with no file edited.

  1. terminal run statuses : `TERMINAL_RUN_STATUSES` in shared/types/chain-session.ts against
                             `db_reader.TERMINAL_RUN_STATUSES`
  2. operator tokens       : server/tooling/contracts/registries/operators.json (the file BOTH sides
                             read: operator-patterns.ts imports it, operators.py opens it) against
                             what `operators.OPERATORS` loaded; and `operators.py` must stay free of
                             a literal operator token, which would be a copy that outlives the file
  3. hook config defaults  : `hooks.expandedOutput` `@default` (and the prose sentence beside it) in
                             shared/types/config-file.ts against `config_loader.DEFAULT_CONFIG` and
                             the value `is_expanded_output()` returns for a config that says nothing
  4. chain text tokens     : generated JSON/Python projections against chain-id-codec.ts
"""

import ast
import json
import re
import sys
from pathlib import Path

import pytest

HOOKS_DIR = Path(__file__).parent.parent
HOOKS_LIB = HOOKS_DIR / "lib"
if str(HOOKS_LIB) not in sys.path:
    sys.path.insert(0, str(HOOKS_LIB))

import config_loader
import db_reader
import operators

REPO_ROOT = HOOKS_DIR.parent
SERVER_SRC = REPO_ROOT / "server" / "src"
CHAIN_SESSION_TS = SERVER_SRC / "shared" / "types" / "chain-session.ts"
CONFIG_FILE_TS = SERVER_SRC / "shared" / "types" / "config-file.ts"
OPERATOR_PATTERNS_TS = SERVER_SRC / "engine" / "execution" / "parsers" / "operator-patterns.ts"
OPERATORS_REGISTRY = REPO_ROOT / "server" / "tooling" / "contracts" / "registries" / "operators.json"
OPERATORS_PY = HOOKS_LIB / "operators.py"


class TestPromptAnnotationProjection:
    @pytest.fixture(scope="class")
    @staticmethod
    def selector_oracle():
        import subprocess

        probes = [
            ">>Root",
            "%clean @CAGEERF #analytical >>Parent/Child/Deep",
            ">>7-leading/root-child",
            ">>MiXeD/Unknown",
            ">>Parent/",
            ">>Parent//Child",
            ">>Parent/../Child",
            ">>Parent/Child.ext",
            ">>Parent/Child%20",
            ">>Parent/Child\\extra",
            ">>Parent/Child:tail",
            ">>Parent/Child@tail",
            ">>Parent/Child#tail",
            ">>Parent/Child%clean",
            '>>Parent/Child?tail ? "condition" : >>notes',
            ">>>bad --> >>notes",
            'text:">>Root --> >>Child"',
            "text:'>>Root ==> >>Child'",
            '>>Root text:"--> >>fake" --> >>Parent/Child',
            r'>>Root text:"escaped \" >>fake --> still quoted" ==> >>Parent/Child',
            ">>Root+>>Child",
            '>>Root? "ok" : >>Parent/Child',
            ">>Root → >>Child",
            ">>Parent/Child\u0085tail",
            ">>Parent/Child\u00a0tail",
            ">>\ufeffParent/Child",
            '>>Root? "a\u2028b" : >>Child',
            '>>Root?\u0085"ok" : >>Child',
        ]
        script = """
import { readPromptSelector, isPositionInsideQuotes, PROMPT_INVOCATION_MARKER_PATTERN } from './src/engine/execution/parsers/parser-utils.ts';
import { OPERATOR_PATTERNS } from './src/engine/execution/parsers/operator-patterns.ts';
const probes = JSON.parse(process.argv[1]);
const delimiters = Object.values(OPERATOR_PATTERNS).filter(op => op.role === 'delimiter' && op.status === 'implemented');
console.log(JSON.stringify(probes.map(text => ({
  annotations: [...text.matchAll(PROMPT_INVOCATION_MARKER_PATTERN)].filter(m => !isPositionInsideQuotes(text, m.index)).map(m => readPromptSelector(text.slice(m.index))?.promptId ?? null),
  chain: delimiters.some(op => [...text.matchAll(new RegExp(op.pattern.source, 'g'))].some(m => !isPositionInsideQuotes(text, m.index)))
}))));
"""
        result = subprocess.run(
            ["node", "--import", "tsx", "--input-type=module", "-e", script, json.dumps(probes)],
            cwd=REPO_ROOT / "server",
            capture_output=True,
            text=True,
            check=True,
        )
        return probes, json.loads(result.stdout)

    def test_actual_typescript_selector_and_quote_outputs_match(self, selector_oracle):
        probes, expected = selector_oracle
        measured = [
            {"annotations": operators.annotate_prompt_references(text), "chain": operators.has_chain_delimiter(text)}
            for text in probes
        ]
        assert measured == expected
        assert expected[0]["annotations"] == ["Root"]
        assert expected[15]["annotations"] == [None, "notes"]

    def test_generated_json_and_python_twin_match(self):
        from _generated.extraction_patterns import EXTRACTION_PATTERNS

        generated = json.loads((HOOKS_LIB / "_generated" / "extraction-patterns.json").read_text())
        assert generated == EXTRACTION_PATTERNS

    def test_json_unavailable_does_not_replace_python_projection(self, monkeypatch):
        original = Path.read_text
        generated = HOOKS_LIB / "_generated" / "extraction-patterns.json"

        def unavailable(path, *args, **kwargs):
            if path == generated:
                raise OSError("planted unavailable JSON")
            return original(path, *args, **kwargs)

        monkeypatch.setattr(Path, "read_text", unavailable)
        with pytest.raises(OSError, match="planted unavailable"):
            generated.read_text()
        assert operators.annotate_prompt_references(">>Parent/Child") == ["Parent/Child"]


# ── 1. terminal run statuses ──────────────────────────────────────────────────


def ts_terminal_run_statuses(ts_text: str) -> set[str]:
    """The string members of the canonical `TERMINAL_RUN_STATUSES` array literal."""
    match = re.search(r"\b(?:export\s+)?const\s+TERMINAL_RUN_STATUSES\b[^=]*=\s*\[([^\]]*)\]", ts_text)
    assert match, "TERMINAL_RUN_STATUSES array literal not found in chain-session.ts"
    return set(re.findall(r"'([^']+)'", match.group(1)))


def terminal_status_mismatch(ts_text: str) -> list[str]:
    ts = ts_terminal_run_statuses(ts_text)
    py = set(db_reader.TERMINAL_RUN_STATUSES)
    problems = []
    if ts - py:
        problems.append(f"TERMINAL_RUN_STATUSES: TypeScript declares {sorted(ts - py)} that db_reader.py lacks")
    if py - ts:
        problems.append(f"TERMINAL_RUN_STATUSES: db_reader.py holds {sorted(py - ts)} that TypeScript does not declare")
    return problems


class TestTerminalRunStatuses:
    def test_python_set_equals_typescript_array(self):
        assert terminal_status_mismatch(CHAIN_SESSION_TS.read_text(encoding="utf-8")) == []

    def test_positive_control_a_status_added_on_the_typescript_side_fails_by_name(self):
        planted = CHAIN_SESSION_TS.read_text(encoding="utf-8").replace(
            "'cancelled',", "'cancelled',\n  'abandoned',", 1
        )
        assert planted != CHAIN_SESSION_TS.read_text(encoding="utf-8")

        problems = terminal_status_mismatch(planted)

        assert any("TERMINAL_RUN_STATUSES" in p and "abandoned" in p for p in problems)

    def test_positive_control_a_status_dropped_on_the_typescript_side_fails_by_name(self):
        planted = CHAIN_SESSION_TS.read_text(encoding="utf-8").replace("'failed',", "", 1)

        problems = terminal_status_mismatch(planted)

        assert any("TERMINAL_RUN_STATUSES" in p and "failed" in p for p in problems)


# ── 2. operator tokens ────────────────────────────────────────────────────────


def hook_visible_registry_operators(registry_text: str) -> dict[str, dict]:
    contract = json.loads(registry_text)
    return {op["id"]: op for op in contract["operators"] if op.get("detectInHooks", False)}


def operator_mismatch(registry_text: str) -> list[str]:
    """Compare the registry text with what `operators.py` loaded at import."""
    expected = hook_visible_registry_operators(registry_text)
    problems = []
    if set(expected) != set(operators.OPERATORS):
        problems.append(
            f"operator ids: registry says {sorted(expected)}, operators.OPERATORS holds {sorted(operators.OPERATORS)}"
        )
    for op_id in sorted(set(expected) & set(operators.OPERATORS)):
        loaded, declared = operators.OPERATORS[op_id], expected[op_id]
        if loaded["symbol"] != declared["symbol"]:
            problems.append(f"operator {op_id} symbol: registry {declared['symbol']!r}, hooks {loaded['symbol']!r}")
        if loaded["pattern"].pattern != declared["pattern"]["typescript"]:
            problems.append(f"operator {op_id} pattern differs between the registry and operators.OPERATORS")
        if loaded.get("role") != declared.get("role", "modifier"):
            problems.append(f"operator {op_id} role: registry {declared.get('role')!r}, hooks {loaded.get('role')!r}")
    registry_delimiters = sorted(op["symbol"] for op in expected.values() if op.get("role") == "delimiter")
    if sorted(operators.get_delimiter_symbols()) != registry_delimiters:
        problems.append(
            f"delimiter symbols: registry {registry_delimiters}, get_delimiter_symbols() {operators.get_delimiter_symbols()}"
        )
    return problems


class TestOperatorTokens:
    def test_loaded_operators_equal_the_registry(self):
        assert operator_mismatch(OPERATORS_REGISTRY.read_text(encoding="utf-8")) == []

    def test_typescript_parser_reads_the_same_registry_file(self):
        # Parity holds by construction only while BOTH sides open the one file.
        text = OPERATOR_PATTERNS_TS.read_text(encoding="utf-8")
        assert "tooling/contracts/registries/operators.json" in text

    def test_hooks_loader_reads_the_same_registry_file(self):
        assert '"registries" / "operators.json"' in OPERATORS_PY.read_text(encoding="utf-8")

    def test_operators_module_holds_no_literal_operator_token(self):
        # A literal in code would be a copy that survives a registry change. Docstrings only
        # describe the tokens, so they are skipped.
        tree = ast.parse(OPERATORS_PY.read_text(encoding="utf-8"))
        docstrings = {
            id(node.body[0].value)
            for node in ast.walk(tree)
            if isinstance(node, ast.Module | ast.FunctionDef | ast.ClassDef)
            and node.body
            and isinstance(node.body[0], ast.Expr)
            and isinstance(node.body[0].value, ast.Constant)
        }
        literals = {
            node.value
            for node in ast.walk(tree)
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings
        }
        symbols = {op["symbol"] for op in json.loads(OPERATORS_REGISTRY.read_text(encoding="utf-8"))["operators"]}

        assert not {s for s in symbols if len(s) > 1} & literals

    def test_positive_control_a_changed_registry_symbol_fails_by_name(self):
        planted = json.loads(OPERATORS_REGISTRY.read_text(encoding="utf-8"))
        for op in planted["operators"]:
            if op["id"] == "chain":
                op["symbol"] = "~~>"

        problems = operator_mismatch(json.dumps(planted))

        assert any("operator chain symbol" in p for p in problems)

    def test_positive_control_a_new_hook_visible_operator_fails_by_name(self):
        planted = json.loads(OPERATORS_REGISTRY.read_text(encoding="utf-8"))
        planted["operators"].append(
            {
                "id": "planted",
                "symbol": "@@",
                "role": "modifier",
                "detectInHooks": True,
                "pattern": {"typescript": "@@"},
            }
        )

        problems = operator_mismatch(json.dumps(planted))

        assert any("operator ids" in p and "planted" in p for p in problems)


# ── 3. hook config defaults ───────────────────────────────────────────────────


def ts_expanded_output_contract(ts_text: str) -> tuple[bool, bool | None]:
    """`(@default value, value the prose claims an absent key resolves to or None)`."""
    block = re.search(r"interface ConfigFileHooks\s*\{(.*?)\n\}", ts_text, re.DOTALL)
    assert block, "ConfigFileHooks interface not found in config-file.ts"
    body = block.group(1)
    default = re.search(r"@default\s+(true|false)", body)
    assert default, "ConfigFileHooks.expandedOutput carries no @default"
    prose = re.search(r"An absent key resolves to `(true|false)`", body)
    return default.group(1) == "true", (prose.group(1) == "true") if prose else None


def hook_default_mismatch(ts_text: str, python_default: bool, python_resolved: bool) -> list[str]:
    ts_default, ts_prose = ts_expanded_output_contract(ts_text)
    problems = []
    if python_default != ts_default:
        problems.append(
            f"hooks.expandedOutput default: config-file.ts @default {ts_default}, config_loader DEFAULT_CONFIG {python_default}"
        )
    if python_resolved != ts_default:
        problems.append(
            f"hooks.expandedOutput default: config-file.ts @default {ts_default}, is_expanded_output() {python_resolved}"
        )
    if ts_prose is not None and ts_prose != python_default:
        problems.append(
            f"hooks.expandedOutput prose: config-file.ts says an absent key resolves to {ts_prose}, config_loader {python_default}"
        )
    return problems


class TestHookConfigDefaults:
    @pytest.fixture
    def python_values(self, patch_workspace) -> tuple[bool, bool]:
        # A real workspace with no config file at all: `is_expanded_output()` takes its fallback.
        return config_loader.DEFAULT_CONFIG["hooks"]["expandedOutput"], config_loader.is_expanded_output()

    def test_python_defaults_equal_the_typescript_contract(self, python_values):
        assert hook_default_mismatch(CONFIG_FILE_TS.read_text(encoding="utf-8"), *python_values) == []

    def test_positive_control_a_flipped_typescript_default_fails_by_name(self, python_values):
        text = CONFIG_FILE_TS.read_text(encoding="utf-8")
        planted = re.sub(r"(interface ConfigFileHooks.*?@default\s+)true", r"\1false", text, count=1, flags=re.DOTALL)
        assert planted != text

        problems = hook_default_mismatch(planted, *python_values)

        assert any("hooks.expandedOutput default" in p and "@default False" in p for p in problems)

    def test_positive_control_a_contradicting_prose_sentence_fails_by_name(self, python_values):
        text = CONFIG_FILE_TS.read_text(encoding="utf-8")
        planted = re.sub(r"(An absent key resolves to `)true(`)", r"\1false\2", text, count=1)
        assert planted != text

        problems = hook_default_mismatch(planted, *python_values)

        assert any("hooks.expandedOutput prose" in p for p in problems)


# ── 4. chain text-token projections ───────────────────────────────────────────


class TestChainExtractionProjection:
    @pytest.fixture(scope="class")
    @staticmethod
    def owner_projection():
        import subprocess

        script = """
import { readFileSync } from 'node:fs';
import { CHAIN_ID_PATTERN_SOURCE, CHAIN_ID_PATTERN, isChainId } from './src/shared/utils/chain-id-codec.ts';
const patterns = JSON.parse(readFileSync('../hooks/lib/_generated/extraction-patterns.json', 'utf8'));
const probes = JSON.parse(process.argv[1]);
const pattern = new RegExp(patterns.chainId);
console.log(JSON.stringify({ source: CHAIN_ID_PATTERN_SOURCE, strict: CHAIN_ID_PATTERN.source,
  matches: probes.map(text => pattern.exec(text)?.[1] ?? null),
  accepted: probes.map(isChainId) }));
"""
        probes = [
            "chain-analysis",
            "chain-implementation_plan/plan_table#1",
            "chain-Team-Legacy/Child_Name/9deep#01",
            "chain-Team/9child#0",
            'chain_id:"chain-Team/9child#01"',
            "**chain-team/phase/plan#1**",
            "prefixchain-team/child#1",
            "/chain-team/child#1",
            "chain-team/child#latest",
            "chain-team/child#1#2",
            "chain-team/child#1/extra",
            "chain-team//child#1",
            "chain-team.child#1",
            "chain-team/../child#1",
            "chain-team/%63hild#1",
            "chain-team\\child#1",
            "échain-team/child#1",
            "chain-team/child#1é",
            "chain-team/child#1\u0301",
            "chain-team/child#1\u200b",
            "\u0085chain-team/child#1",
            "chain-team/child#1\u00a0",
            "chain-team/child#1\u2028",
            "chain-team/child#\u0661",
            "chain-team/child#1\u0661",
            "chain-team/child#1\n",
        ]
        result = subprocess.run(
            ["node", "--import", "tsx", "--input-type=module", "-e", script, json.dumps(probes)],
            cwd=REPO_ROOT / "server",
            capture_output=True,
            text=True,
            check=True,
        )
        return probes, json.loads(result.stdout)

    def test_generated_text_projection_agrees_with_codec_and_python(self, owner_projection):
        import session_state

        probes, owner = owner_projection
        assert owner["strict"].replace(r"\/", "/") == f"^{owner['source']}(?![\\s\\S])"
        expected = (
            [
                "chain-analysis",
                "chain-implementation_plan/plan_table#1",
                "chain-Team-Legacy/Child_Name/9deep#01",
                "chain-Team/9child#0",
                "chain-Team/9child#01",
                "chain-team/phase/plan#1",
            ]
            + [None] * 19
            + ["chain-team/child#1"]
        )
        matches = [
            match.group(1) if (match := re.search(session_state._PATTERNS["chainId"], text)) else None
            for text in probes
        ]
        assert owner["matches"] == matches == expected
        assert owner["accepted"] == [True] * 4 + [False] * (len(probes) - 4)

    def test_generated_fallback_equals_json_and_python_has_no_private_grammar(self):
        import session_state
        from _generated.extraction_patterns import EXTRACTION_PATTERNS

        generated = json.loads((HOOKS_LIB / "_generated" / "extraction-patterns.json").read_text())
        assert session_state._load_patterns() == generated == EXTRACTION_PATTERNS
        tree = ast.parse((HOOKS_LIB / "session_state.py").read_text())
        assert not any(
            isinstance(node, ast.Dict)
            and any(isinstance(key, ast.Constant) and key.value == "chainId" for key in node.keys)
            for node in ast.walk(tree)
        )

    @pytest.mark.parametrize("unavailable", ["missing", "unreadable", "malformed"])
    def test_json_unavailable_fallback_preserves_qualified_token(self, monkeypatch, unavailable):
        import io

        import session_state
        from _generated.extraction_patterns import EXTRACTION_PATTERNS

        def unavailable_json(*args, **kwargs):
            if unavailable == "missing":
                raise FileNotFoundError("planted missing generated JSON")
            if unavailable == "unreadable":
                raise PermissionError("planted unreadable generated JSON")
            return io.StringIO("{")

        monkeypatch.setattr(session_state, "open", unavailable_json, raising=False)
        loaded = session_state._load_patterns()
        assert loaded == EXTRACTION_PATTERNS
        monkeypatch.setattr(session_state, "_PATTERNS", loaded)
        token = "chain-Team-Legacy/Child_Name/9deep#01"
        state = session_state.parse_prompt_engine_response(f'Progress 1/3\nchain_id="{token}"')
        assert state is not None and state["chain_id"] == token

    @pytest.mark.parametrize(
        "token",
        [
            "chain-analysis",
            "chain-Legacy-Prompt#0",
            "chain-implementation_plan/plan_table#1",
            "chain-Team-Legacy/Child_Name/9deep#01",
        ],
    )
    @pytest.mark.parametrize(
        "frame",
        [
            "Chain: {token}",
            "**{token}**",
            "`{token}`",
            'chain_id="{token}"',
            'chain_id:"{token}"',
            "HANDOFF RESULT chain={token} node=work attempt=1 claim=receipt",
        ],
    )
    def test_complete_qualified_text_tokens_preserve_exact_bytes(self, token, frame):
        from session_state import parse_prompt_engine_response

        state = parse_prompt_engine_response(f"Progress 1/3\n{frame.format(token=token)}")
        assert state is not None and state["chain_id"] == token

    @pytest.mark.parametrize(
        "token",
        [
            "prefixchain-team/child#1",
            "/chain-team/child#1",
            ".chain-team/child#1",
            "@chain-team/child#1",
            "échain-team/child#1",
            "中chain-team/child#1",
            "chain-team/child#1é",
            "chain-team/child#1中",
            "chain-team/child#1\u0301",
            "chain-team/child#1\u200b",
            "\u0085chain-team/child#1",
            "chain-team/child#1\u00a0",
            "chain-team/child#1\u2028",
            "chain-team/child#\u0661",
            "chain-team/child#1\u0661",
            "chain-team/child#latest",
            "chain-team/child#",
            "chain-team/child#-1",
            "chain-team/child#1#2",
            "chain-team/child#1.0",
            "chain-team/child#1/extra",
            "chain-team//child#1",
            "chain-team/../child#1",
            "chain-team/%63hild#1",
            "chain-team\\child#1",
            "chain-team/child#1@tail",
        ],
    )
    def test_invalid_ascii_and_unicode_tokens_are_not_prefix_truncated(self, token):
        from session_state import parse_prompt_engine_response

        state = parse_prompt_engine_response(f"Progress 1/3\n`{token}`")
        assert state is not None and state["chain_id"] == ""

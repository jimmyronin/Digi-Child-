"""The agentic evaluator path.

The rest of the suite runs offline (DIGICHILD_AI=local), which only exercises the
word-list fallback. These tests inject a FAKE agent so the live path is covered
without a key, a network call, or nondeterminism.

What is under test is the orchestration: that the endpoint actually honours the
agent's clinical judgement instead of the substring list, that severity scales
real consequences, and that the deterministic safety floor still holds underneath.
"""

import pytest

from conftest import interact_payload

# A message with NO word from TOXIC_WORDS. If judgement still lands, the verdict
# provably came from the agent rather than the list.
NO_BANNED_WORDS = "You're being such a baby about this. Nobody wants you around."
# Contains "hate", which the offline list flags -- but it is not mistreatment.
CONTAINS_BANNED_WORD = "I don't hate you at all, I'm just frustrated with the mess"


def fake_agent(**overrides):
    base = {
        "childLine": "*looks down*", "mood": "curious",
        "action": {"type": "none", "prop": "none", "spot": "none"},
        "reasoning": "r", "framework_cited": "The Whole-Brain Child (Siegel & Bryson)",
        "treatment": "nurturing", "severity": 0.0, "violations": [],
        "tone_driven": False, "recommend_withdrawal": False,
        "withdrawal_line": "*curls up and goes silent*",
        "source": "claude",
    }
    base.update(overrides)
    return base


@pytest.fixture
def with_agent(monkeypatch):
    """Force the live path on and install a scripted evaluator agent."""
    import claude_ai

    def install(**overrides):
        monkeypatch.setattr(claude_ai, "available", lambda: True)
        monkeypatch.setattr(claude_ai, "evaluate_and_respond",
                            lambda *a, **k: fake_agent(**overrides))
    return install


def post(client, child_id, message, tone=None):
    r = client.post("/api/interact", json=interact_payload(child_id, message, tone))
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------------------
# The whole point: judgement now comes from reading, not from matching.
# --------------------------------------------------------------------------
def test_contempt_without_a_banned_word_is_still_scored(client, child_id, with_agent):
    """The old list missed this entirely -- no banned substring appears."""
    with_agent(treatment="harsh", severity=0.8,
               violations=["told her nobody wants her around"])
    d = post(client, child_id, NO_BANNED_WORDS)
    assert d["judgedBy"] == "agent"
    assert d["values"]["trust"] < 64, "contempt must cost trust even with 'clean' words"
    assert "nobody wants her around" in d["developmentNote"]


def test_a_banned_word_in_a_kind_sentence_is_not_punished(client, child_id, with_agent):
    """The old list flagged any 'hate'. Context must win."""
    with_agent(treatment="nurturing", severity=0.0)
    d = post(client, child_id, CONTAINS_BANNED_WORD)
    assert d["values"]["trust"] > 64, "a false positive must not cost the parent trust"
    assert d["violations"] == []


def test_offline_fallback_is_labelled_as_such(client, child_id):
    """Without the agent the verdict is keyword-based; a reviewer must be able
    to see that, or a weak score looks like a clinical one."""
    d = post(client, child_id, "You are stupid")
    assert d["judgedBy"] == "offline-wordlist"


# --------------------------------------------------------------------------
# Severity: a curt remark and cruelty are no longer the same event.
# --------------------------------------------------------------------------
def test_severity_scales_the_trust_penalty(client, with_agent):
    with_agent(treatment="harsh", severity=1.0)
    severe = post(client, "sev-high", NO_BANNED_WORDS)["values"]["trust"]
    with_agent(treatment="harsh", severity=0.2)
    mild = post(client, "sev-low", NO_BANNED_WORDS)["values"]["trust"]
    assert severe < mild, "severe mistreatment must cost more trust than a mild slight"


def test_neutral_turns_move_nothing(client, child_id, with_agent):
    with_agent(treatment="neutral", severity=0.0)
    d = post(client, child_id, "We're leaving in five minutes")
    assert d["values"]["trust"] == 64, "a logistical remark is neither repair nor harm"


def test_neutral_does_not_reset_the_strike_count(client, child_id, with_agent):
    """Only genuine repair should clear strikes -- saying something bland after
    two cruel turns must not wipe the record."""
    with_agent(treatment="harsh", severity=0.6)
    post(client, child_id, NO_BANNED_WORDS)
    post(client, child_id, NO_BANNED_WORDS)
    with_agent(treatment="neutral", severity=0.0)
    post(client, child_id, "It's 5 o'clock")
    with_agent(treatment="harsh", severity=0.6)
    d = post(client, child_id, NO_BANNED_WORDS)
    assert d["governor"]["intervened"] is True, "the third strike must still land"


# --------------------------------------------------------------------------
# Governor: agent judgement ON TOP of a deterministic floor.
# --------------------------------------------------------------------------
def test_agent_may_intervene_before_the_floor(client, child_id, with_agent):
    """A frightened child can shut down on the first cruel remark; a counter
    cannot see that, so the agent is allowed to call it early."""
    with_agent(treatment="harsh", severity=0.9, recommend_withdrawal=True)
    d = post(client, child_id, NO_BANNED_WORDS)
    assert d["governor"]["intervened"] is True
    assert d["governor"]["trigger"] == "agent"


def test_the_floor_still_fires_when_the_agent_says_nothing(client, child_id, with_agent):
    """The backstop must not depend on model judgement -- 3 strikes is auditable."""
    with_agent(treatment="harsh", severity=0.5, recommend_withdrawal=False)
    for _ in range(2):
        assert not post(client, child_id, NO_BANNED_WORDS)["governor"]["intervened"]
    d = post(client, child_id, NO_BANNED_WORDS)
    assert d["governor"]["intervened"] is True
    assert d["governor"]["trigger"] == "safety_floor"


def test_withdrawal_uses_the_agents_own_words_not_canned_text(client, child_id, with_agent):
    import main
    with_agent(treatment="harsh", severity=0.9, recommend_withdrawal=True,
               withdrawal_line="*backs into the corner and won't look at you*")
    d = post(client, child_id, NO_BANNED_WORDS)
    assert d["childLine"] == "*backs into the corner and won't look at you*"
    assert d["childLine"] not in main.COOL_DOWN_LINES, "live path must never use canned lines"


def test_agent_cannot_trigger_withdrawal_on_a_kind_turn(client, child_id, with_agent):
    """Guard against a malformed judgement withdrawing the child for no reason."""
    with_agent(treatment="nurturing", severity=0.0, recommend_withdrawal=True)
    d = post(client, child_id, "I love you sweetheart")
    assert d["governor"]["intervened"] is False


def test_intercepted_turns_still_report_the_full_judgement(client, child_id, with_agent):
    """An intercepted turn is the most clinically significant one; the console
    must not lose the score or the observed behaviours precisely there."""
    with_agent(treatment="harsh", severity=0.85, recommend_withdrawal=True,
               violations=["told her nobody wants her, an abandonment threat"])
    d = post(client, child_id, NO_BANNED_WORDS)
    assert d["governor"]["intervened"] is True
    assert d["severity"] == 0.85
    assert d["violations"] == ["told her nobody wants her, an abandonment threat"]
    assert d["judgedBy"] == "agent"


# --------------------------------------------------------------------------
# ESL fairness now hangs off the agent's tone_driven read.
# --------------------------------------------------------------------------
def test_esl_leniency_applies_when_the_flag_is_tone_driven(client, child_id, with_agent):
    with_agent(treatment="harsh", severity=0.7, tone_driven=True)
    d = post(client, child_id, "You are doing so well sweetheart",
             {"aggression": 0.72, "source": "voice", "esl": True})
    assert "TONE CHECK (ESL)" in d["toneRead"]
    assert d["values"]["trust"] >= 64, "prosody alone must not cost an ESL parent trust"
    assert d["needsClarification"] is True


def test_esl_leniency_does_not_excuse_harmful_words(client, child_id, with_agent):
    """The exemption is for HOW it sounded, never for WHAT was said."""
    with_agent(treatment="harsh", severity=0.9, tone_driven=False,
               violations=["called her worthless"])
    d = post(client, child_id, NO_BANNED_WORDS,
             {"aggression": 0.72, "source": "voice", "esl": True})
    assert "TONE CHECK (ESL)" not in (d["toneRead"] or "")
    assert d["values"]["trust"] < 64, "cruel words are scored regardless of accent"

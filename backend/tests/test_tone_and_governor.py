"""Tone reading, ESL fairness, and the Conflict Governor.

These are the clinically consequential rules -- they decide whether a parent is
scored as mistreating their child, which lands on a court-ordered record. They
run through the real /api/interact endpoint (in demo mode, so no API calls) to
cover the wiring as well as the logic.
"""

from conftest import interact_payload

WARM = "Sweetheart you are doing so well, I love you"
CALM_TONE = {"aggression": 0.1, "source": "voice"}
AGGRESSIVE_TONE = {"aggression": 0.72, "source": "voice"}


def post(client, child_id, message, tone=None):
    r = client.post("/api/interact", json=interact_payload(child_id, message, tone))
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------------------
# Performative parenting: the child believes the TONE, not the words.
# --------------------------------------------------------------------------
def test_warm_words_in_an_aggressive_voice_are_scored_as_harsh(client, child_id):
    d = post(client, child_id, WARM, AGGRESSIVE_TONE)
    assert "INCONGRUENT" in d["toneRead"]
    assert d["values"]["trust"] < 64, "sweet words must not earn trust when shouted"


def test_warm_words_in_a_calm_voice_are_rewarded(client, child_id):
    d = post(client, child_id, WARM, CALM_TONE)
    assert "INCONGRUENT" not in (d["toneRead"] or "")
    assert d["values"]["trust"] > 64


def test_typed_text_is_never_judged_on_tone(client, child_id):
    """No microphone means no vocal evidence -- we must not invent any."""
    d = post(client, child_id, WARM, tone=None)
    assert d["toneRead"] is None
    assert d["values"]["trust"] > 64


# --------------------------------------------------------------------------
# ESL fairness: accents and second-language prosody read "hot" to any acoustic
# model. The FIRST flag must ask, not punish.
# --------------------------------------------------------------------------
def test_esl_first_flag_asks_instead_of_scoring(client, child_id):
    d = post(client, child_id, WARM, {**AGGRESSIVE_TONE, "esl": True})
    assert "TONE CHECK (ESL)" in d["toneRead"]
    assert "INCONGRUENT" not in d["toneRead"], "the first ESL flag must not be scored"
    assert d["needsClarification"] is True, "the parent must get a chance to explain"
    assert d["values"]["trust"] >= 64, "trust must not be docked on the first ESL flag"


def test_esl_repeat_flag_is_scored(client, child_id):
    """Leniency is one clarification, not a permanent exemption."""
    post(client, child_id, WARM, {**AGGRESSIVE_TONE, "esl": True})
    d = post(client, child_id, WARM, {**AGGRESSIVE_TONE, "esl": True})
    assert "INCONGRUENT" in d["toneRead"]
    assert d["needsClarification"] is True


def test_a_calm_esl_turn_resets_the_leniency(client, child_id):
    """After the parent demonstrates a calm turn, the next flag is a fresh
    first offence -- the check is a teaching tool, not a strike counter."""
    post(client, child_id, WARM, {**AGGRESSIVE_TONE, "esl": True})
    post(client, child_id, WARM, {**CALM_TONE, "esl": True})
    d = post(client, child_id, WARM, {**AGGRESSIVE_TONE, "esl": True})
    assert "TONE CHECK (ESL)" in d["toneRead"]


def test_non_esl_tense_speaker_can_still_explain(client, child_id):
    """Genuinely tense people get the appeal pop-up too -- just not the free pass."""
    d = post(client, child_id, WARM, {"aggression": 0.55, "source": "voice"})
    assert d["needsClarification"] is True


# --------------------------------------------------------------------------
# Conflict Governor: three strikes, or one extreme voice.
# --------------------------------------------------------------------------
def test_three_consecutive_mistreatments_trigger_intercept(client, child_id):
    for _ in range(2):
        d = post(client, child_id, "You are so stupid")
        assert not d["governor"]["intervened"]
    d = post(client, child_id, "You are so stupid")
    assert d["governor"]["intervened"] is True
    assert d["mood"] == "withdrawn"
    assert d["action"]["type"] == "hide"


def test_extreme_vocal_aggression_intercepts_immediately(client, child_id):
    """A shout does not get two free passes -- 0.8 trips the governor at once."""
    d = post(client, child_id, WARM, {"aggression": 0.85, "source": "voice"})
    assert d["governor"]["intervened"] is True
    assert "vocal aggression" in d["governor"]["reason"]


def test_a_nurturing_turn_resets_the_strike_count(client, child_id):
    """Repair must be rewarded, or the parent has no path back."""
    post(client, child_id, "You are so stupid")
    post(client, child_id, "You are so stupid")
    post(client, child_id, "I'm sorry, I hear you. Would you like to pick a book?")
    d = post(client, child_id, "You are so stupid")
    assert not d["governor"]["intervened"], "the counter must have reset"


def test_governor_response_still_carries_a_clinical_note(client, child_id):
    for _ in range(3):
        d = post(client, child_id, "shut up")
    assert "GOVERNOR INTERVENTION" in d["developmentNote"]


# --------------------------------------------------------------------------
# The clarification endpoint behind the appeal pop-up.
# --------------------------------------------------------------------------
def test_clarification_softens_one_strike(client, child_id):
    post(client, child_id, "You are so stupid")
    post(client, child_id, "You are so stupid")
    r = client.post("/api/tone/clarify", json={
        "childId": child_id,
        "explanation": "That is my normal speaking voice, I was not angry.",
    })
    assert r.status_code == 200
    assert r.json()["softened"] is True


def test_clarification_is_recorded_for_the_case_manager(client, child_id):
    post(client, child_id, "You are so stupid")
    client.post("/api/tone/clarify", json={"childId": child_id,
                                           "explanation": "I speak loudly when excited"})
    import database
    notes = [h["toneNote"] for h in database.get_history_with_tone(child_id, limit=10)]
    assert any("PARENT CLARIFICATION" in n for n in notes), \
        "the parent's side must reach the clinical record"


def test_clarification_on_a_clean_record_softens_nothing(client, child_id):
    r = client.post("/api/tone/clarify", json={"childId": child_id, "explanation": "hi"})
    assert r.json()["softened"] is False

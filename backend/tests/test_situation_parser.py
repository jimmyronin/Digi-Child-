"""Agent 1's demo-mode situation reader.

When Claude is unavailable the intake still has to understand the parent's life
(employment, caregiving duties, constraints) rather than just their free hours.
These tests pin the regex fallback, which is what runs on the free deployment.
"""

from agent1_coordinator import _regex_situation


def test_extracts_employment_with_finish_time():
    s = _regex_situation("I work until 5pm on weekdays")
    assert "employed" in s["employment"]
    assert "5" in s["employment"], "the finish time is what makes the slot decidable"


def test_night_shifts_are_distinguished_from_day_work():
    s = _regex_situation("I work night shifts at the hospital")
    assert "night" in s["employment"]


def test_unemployment_is_not_read_as_employment():
    s = _regex_situation("I am currently unemployed and looking for work")
    assert "not currently employed" in s["employment"]


def test_extracts_kindergarten_pickup():
    s = _regex_situation("I pick my daughter up from kindergarten at 3")
    assert "kindergarten" in s["caregiving"]


def test_extracts_transport_constraint():
    s = _regex_situation("I have no car so I take the bus everywhere")
    assert "transportation" in s["constraints"]


def test_combined_situation_captures_every_dimension():
    s = _regex_situation(
        "I work until 5pm, I pick my son up from kindergarten at 3, and I have no car"
    )
    assert s["employment"]
    assert s["caregiving"]
    assert s["constraints"]
    # the summary is what the case manager actually reads on the approval card
    assert s["summary"].startswith("Parent reports:")


def test_silence_is_not_invented():
    """No details given must not produce fabricated ones -- a clinical record
    must never contain guesses about a parent's employment or childcare."""
    s = _regex_situation("Tuesday morning works for me")
    assert s["employment"] == ""
    assert s["caregiving"] == ""
    assert s["constraints"] == ""
    assert "No life-situation details" in s["summary"]


def test_always_returns_the_full_shape():
    # the approval card indexes these keys unconditionally
    s = _regex_situation("anything at all")
    assert set(s) == {"employment", "caregiving", "constraints", "summary"}

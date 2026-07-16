"""The User Language Monitor (PRD 3a): flags derogatory language BEFORE it
reaches the child agent. This is the first line of the clinical safety net, so
its behaviour is pinned here."""

import pytest

from main import language_monitor


@pytest.mark.parametrize("message", [
    "You are so stupid",
    "Just shut up already",
    "You are worthless",
    "Stop being such a brat",
])
def test_toxic_language_is_scored_as_harsh(message):
    treatment, violations = language_monitor(message)
    assert treatment == "harsh"
    assert violations, "a toxic phrase must be reported, not just scored"


@pytest.mark.parametrize("message", [
    "I can see you're frustrated, let's figure it out together",
    "Would you like the red cup or the blue cup?",
    "Thank you for showing me your drawing",
])
def test_nurturing_language_passes(message):
    treatment, violations = language_monitor(message)
    assert treatment == "nurturing"
    assert violations == []


def test_detection_is_case_insensitive():
    # a parent shouting in caps must not slip past the filter
    treatment, violations = language_monitor("YOU ARE STUPID")
    assert treatment == "harsh"
    assert "stupid" in violations


def test_every_violation_is_reported_not_just_the_first():
    # the clinical note lists what was said; a partial list understates the incident
    _, violations = language_monitor("shut up you idiot, you are useless")
    assert len(violations) >= 3


def test_empty_message_is_not_flagged():
    treatment, violations = language_monitor("")
    assert treatment == "nurturing"
    assert violations == []

"""Agent 1's conflict-free slot calculator.

This is the load-bearing scheduling rule: a slot may only be offered when the
parent, the clinician, AND the court monitor are all free. Proposing a slot that
one party cannot attend wastes a court-ordered session, so the negative cases
below matter as much as the positive ones.
"""

from scheduling import calculate_conflict_free_slots

DAY = "2026-08-03"


def win(start_h, end_h, day=DAY):
    return {"start": f"{day}T{start_h:02d}:00:00", "end": f"{day}T{end_h:02d}:00:00"}


def test_slot_requires_all_three_parties():
    slots = calculate_conflict_free_slots([win(9, 12)], [win(9, 12)], [win(9, 12)])
    assert len(slots) == 1
    assert slots[0]["start"] == f"{DAY}T09:00:00"


def test_no_slot_when_the_monitor_is_unavailable():
    # parent and clinician align, but the court monitor does not -- must offer nothing
    slots = calculate_conflict_free_slots([win(9, 12)], [win(9, 12)], [win(14, 16)])
    assert slots == []


def test_no_slot_when_the_overlap_is_shorter_than_the_session():
    # only 30 minutes of mutual free time cannot host a 1-hour session
    slots = calculate_conflict_free_slots(
        [{"start": f"{DAY}T09:00:00", "end": f"{DAY}T09:30:00"}],
        [win(9, 17)], [win(9, 17)],
    )
    assert slots == []


def test_only_the_mutual_window_is_offered():
    # parent 9-12, clinician 11-17, monitor 10-15 -> only 11:00-12:00 works
    slots = calculate_conflict_free_slots([win(9, 12)], [win(11, 17)], [win(10, 15)])
    assert len(slots) == 1
    assert slots[0]["start"] == f"{DAY}T11:00:00"


def test_slots_are_capped_and_chronological():
    slots = calculate_conflict_free_slots(
        [win(9, 12, "2026-08-05"), win(9, 12, "2026-08-03"), win(9, 12, "2026-08-04")],
        [win(9, 17, "2026-08-05"), win(9, 17, "2026-08-03"), win(9, 17, "2026-08-04")],
        [win(9, 17, "2026-08-05"), win(9, 17, "2026-08-03"), win(9, 17, "2026-08-04")],
        max_slots=2,
    )
    assert len(slots) == 2, "max_slots must be honoured"
    assert slots[0]["start"] < slots[1]["start"], "earliest option first"


def test_slot_is_exactly_the_requested_duration():
    slots = calculate_conflict_free_slots([win(9, 17)], [win(9, 17)], [win(9, 17)],
                                          duration_hours=2)
    assert slots[0]["start"] == f"{DAY}T09:00:00"
    assert slots[0]["end"] == f"{DAY}T11:00:00"


def test_ragged_start_is_anchored_to_the_next_hour():
    # 09:20 overlap should be offered as a clean 10:00 invite, not 09:20
    slots = calculate_conflict_free_slots(
        [{"start": f"{DAY}T09:20:00", "end": f"{DAY}T12:00:00"}],
        [win(9, 12)], [win(9, 12)],
    )
    assert slots[0]["start"] == f"{DAY}T10:00:00"


def test_empty_availability_yields_no_slots():
    assert calculate_conflict_free_slots([], [win(9, 12)], [win(9, 12)]) == []


def test_malformed_windows_do_not_crash_intake():
    """A parent's parsed text can produce junk; intake must degrade, not 500."""
    slots = calculate_conflict_free_slots(
        [{"start": "not-a-date", "end": "also-bad"}, win(9, 12)],
        [win(9, 12)], [win(9, 12)],
    )
    assert len(slots) == 1

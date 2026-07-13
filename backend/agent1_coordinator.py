"""
Agent 1 -- The Intake & Logistics Coordinator.

External-facing concierge for the Digi-Child Clinical Orchestrator. It:
  1. parse_parent_availability   -> normalizes chaotic parent text into ISO windows
  2. check_availability_streams  -> pulls clinician + court-monitor availability
  3. calculate_conflict_free_slots -> isolates 2-3 mutually free options
  4. propose()                   -> fires the human-in-the-loop checkpoint (NO writes)
  5. confirm() / reject()        -> on approval, books + dispatches invites + hands
                                    off (session_id, parent_id, timestamp) to Agent 2;
                                    on rejection, terminates cleanly with zero side effects.

Everything degrades to demo mode: Claude parses the text when available (regex
fallback otherwise), and Google Calendar supplies live streams when available
(the session's stored mock availability otherwise). The full loop therefore runs
end-to-end with or without external credentials.
"""

import re
import datetime

import database
import scheduling
import gcal
import agent2_provisioner as agent2
from orchestrator import broadcast_pause_signal
try:
    import claude_ai
except Exception:  # pragma: no cover - claude_ai should always import
    claude_ai = None


# ---------------------------------------------------------------------------
# Tool 1: parse_parent_availability  (Claude, with a regex demo-mode fallback)
# ---------------------------------------------------------------------------
_WEEKDAYS = {
    "monday": 0, "mon": 0, "tuesday": 1, "tue": 1, "tues": 1, "wednesday": 2, "wed": 2,
    "thursday": 3, "thu": 3, "thurs": 3, "friday": 4, "fri": 4, "saturday": 5, "sat": 5,
    "sunday": 6, "sun": 6,
}
_PARTS = {"morning": (9, 12), "afternoon": (12, 17), "evening": (17, 20), "night": (18, 21)}


def _next_weekday(base, weekday):
    days = (weekday - base.weekday() + 7) % 7
    days = days or 7  # "next <day>" means the upcoming one, not today
    return (base + datetime.timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)


def _regex_parse(raw_text, now):
    """Best-effort heuristic parser for demo mode (no Claude)."""
    text = raw_text.lower()
    windows = []

    # explicit "between 1 and 3 pm"
    for m in re.finditer(r"between\s+(\d{1,2})\s*(?:and|-|to)\s*(\d{1,2})\s*(am|pm)?", text):
        h1, h2, ap = int(m.group(1)), int(m.group(2)), m.group(3)
        if ap == "pm" and h2 < 12:
            h2 += 12
            h1 = h1 + 12 if h1 < 12 else h1
        windows.append(("range", h1, h2))

    # "after 9 am"
    for m in re.finditer(r"after\s+(\d{1,2})\s*(am|pm)?", text):
        h = int(m.group(1))
        if m.group(2) == "pm" and h < 12:
            h += 12
        windows.append(("range", h, min(h + 3, 21)))

    parts_found = [p for p in _PARTS if p in text]
    days_found = []
    for name, wd in _WEEKDAYS.items():
        if re.search(rf"\b{name}\b", text):
            days_found.append(wd)
    if "tomorrow" in text:
        days_found.append(((now.weekday() + 1) % 7))

    out = []
    day_bases = [_next_weekday(now, wd) for wd in days_found] or [
        (now + datetime.timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    ]
    time_ranges = [(a, b) for (_t, a, b) in windows] or \
                  [_PARTS[p] for p in parts_found] or [(9, 12)]

    for day in day_bases:
        for (a, b) in time_ranges:
            start = day.replace(hour=max(0, min(a, 23)))
            end = day.replace(hour=max(1, min(b, 23)))
            if end <= start:
                end = start + datetime.timedelta(hours=2)
            out.append({
                "start": start.isoformat(),
                "end": end.isoformat(),
                "label": start.strftime("%a %b %d, %I%p").replace(" 0", " "),
            })
    return out


def parse_parent_availability(raw_text):
    """Chaotic parent text -> ISO windows. Returns (windows, source)."""
    now = datetime.datetime.now().replace(microsecond=0)
    if claude_ai and claude_ai.available():
        try:
            windows = claude_ai.parse_availability(raw_text, now.isoformat())
            if windows:
                return windows, "claude"
        except Exception as exc:
            print(f"[agent1] Claude parse unavailable ({type(exc).__name__}); regex fallback", flush=True)
    return _regex_parse(raw_text, now), "regex"


# ---------------------------------------------------------------------------
# Tool 2: check_availability_streams (Google Calendar, mock fallback)
# ---------------------------------------------------------------------------
def check_availability_streams(session, time_min_iso, time_max_iso):
    """
    Pull the clinician's and court-monitor's FREE windows for the search range.
    Live via Google Calendar when available; otherwise the session's stored
    availability streams (demo mode). Returns {clinician, monitor, source}.
    """
    if gcal.available():
        try:
            return {
                "clinician": gcal.get_free_windows(session["clinician_id"], time_min_iso, time_max_iso),
                "monitor": gcal.get_free_windows(session["monitor_id"], time_min_iso, time_max_iso),
                "source": "google",
            }
        except Exception as exc:
            print(f"[agent1] Google Calendar unavailable ({type(exc).__name__}); mock streams", flush=True)
    return {
        "clinician": session.get("clinician_availability", []),
        "monitor": session.get("monitor_availability", []),
        "source": "mock",
    }


# ---------------------------------------------------------------------------
# Tool 3 + human-in-the-loop checkpoint: propose()  (NO side effects)
# ---------------------------------------------------------------------------
def propose(session_id, raw_text, window_days=14, duration_hours=1):
    """
    Run the full intake pipeline and return the administration overview card for
    the Clinical Case Manager. Writes NOTHING -- the checkpoint fires here,
    before any booking, invite, or database mutation.
    """
    session = database.get_session(session_id)
    if not session:
        return {"status": "error", "message": "Session not found"}

    parent_windows, parse_source = parse_parent_availability(raw_text)

    now = datetime.datetime.now().replace(microsecond=0)
    time_min = now.isoformat()
    time_max = (now + datetime.timedelta(days=window_days)).isoformat()
    streams = check_availability_streams(session, time_min, time_max)

    slots = scheduling.calculate_conflict_free_slots(
        parent_windows, streams["clinician"], streams["monitor"],
        duration_hours=duration_hours, max_slots=3,
    )

    # persist parsed parent availability (safe: it's the parent's own input, not a booking)
    database.update_session(session_id, parent_availability=parent_windows, status="awaiting_approval")

    return {
        "status": "awaiting_approval" if slots else "no_overlap",
        "checkpoint": True,
        "card": {
            "sessionId": session_id,
            "parentAvailabilitySummary": [w.get("label") or w["start"] for w in parent_windows],
            "proposedSlots": slots,
            "calendarOverlay": {
                "parent": parent_windows,
                "clinician": streams["clinician"],
                "monitor": streams["monitor"],
            },
            "sources": {"parse": parse_source, "streams": streams["source"]},
        },
    }


# ---------------------------------------------------------------------------
# Rejection: terminate cleanly, zero side effects
# ---------------------------------------------------------------------------
def reject(session_id):
    session = database.get_session(session_id)
    if not session:
        return {"status": "error", "message": "Session not found"}
    # no invites, no holds, no booking written -- just reset the loop
    database.update_session(session_id, status="pending_outreach", scheduled_time=None)
    return {"status": "cancelled", "message": "Proposal rejected. No calendar or booking changes were made."}


# ---------------------------------------------------------------------------
# Confirmation: book, dispatch invites, hand off to Agent 2
# ---------------------------------------------------------------------------
def confirm(session_id, chosen_slot):
    session = database.get_session(session_id)
    if not session:
        return {"status": "error", "message": "Session not found"}
    if not chosen_slot or "start" not in chosen_slot:
        return {"status": "error", "message": "No slot chosen"}

    # 1) write the finalized booking
    database.update_session(
        session_id,
        status="scheduled",
        scheduled_time=chosen_slot["start"],
    )

    # 2) dispatch calendar invites (live Google, or mock in demo mode)
    invite = gcal.dispatch_invites(
        summary=f"Digi-Child Clinical Evaluation ({session_id})",
        slot=chosen_slot,
        attendee_emails=[session.get("parent_id"), session.get("clinician_id"), session.get("monitor_id")],
        description="Court-ordered behavioral de-escalation evaluation. Simulation sandbox auto-provisioned on start.",
    )

    # 3) HANDOFF -> Agent 2 (session_id, parent_id, timestamp)
    handoff = {
        "session_id": session_id,
        "parent_id": session.get("parent_id"),
        "scheduled_time": chosen_slot["start"],
    }
    provisioning = agent2.provision(**handoff)

    return {
        "status": "booked",
        "slot": chosen_slot,
        "invites": invite,
        "handoff": handoff,
        "provisioning": provisioning,
    }
async def run_governor_logic(analysis_data):
    # Your existing code that detects the conflict
    if analysis_data['aggression_level'] > 0.8:
        print("Governor Intervention: Threshold exceeded.")
        
        # This sends the signal to the UI Control Channel immediately
        await broadcast_pause_signal("Governor Intervention: Aggressive Pattern Detected")

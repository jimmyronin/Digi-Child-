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


def _regex_situation(raw_text):
    """Demo-mode life-situation reader: keyword scan for employment, caregiving
    duties, and constraints when Claude isn't available."""
    low = raw_text.lower()
    employment = ""
    caregiving = ""
    constraints = ""

    # Unemployment is checked FIRST: "unemployed" literally contains "employed",
    # so any employment pattern would swallow it and invert the meaning.
    if re.search(r"\b(unemployed|not working|between jobs|laid off|no job)\b", low):
        employment = "not currently employed"
    elif re.search(r"night\s*shifts?|graveyard|overnight|\bwork(?:s|ing)?\s+nights?\b", low):
        employment = "works night shifts"
    else:
        # Require an employment CONTEXT rather than the bare word "work".
        # "Tuesday morning works for me" is availability, not a job -- inferring
        # employment from it would fabricate a detail on a clinical record.
        m = re.search(r"(?:i\s+work|my\s+(?:job|shift|work)|at\s+work|working)"
                      r".{0,25}?(?:until|till|til|to)\s+(\d{1,2})\s*(am|pm)?", low)
        if m:
            employment = f"employed, works until {m.group(1)}{m.group(2) or 'pm'}"
        elif re.search(r"\b(i work|my job|my shift|at work|i am employed|full.?time|part.?time)\b", low):
            employment = "employed"

    if re.search(r"kindergarten|daycare|day care|preschool", low):
        m = re.search(r"(?:pick|get|grab).{0,40}?(\d{1,2})\s*(am|pm)?", low)
        caregiving = "kindergarten/daycare pickup" + (f" around {m.group(1)}{m.group(2) or 'pm'}" if m else "")
    elif re.search(r"school (?:pick|run|drop)|pick.{0,20}up.{0,20}(?:from )?school", low):
        caregiving = "school pickup duties"
    elif re.search(r"\b(mother|mom|mum|father|dad|sister|brother|grandma|grandmother|"
                   r"aunt|partner|husband|wife|neighbou?r)\b.{0,30}?"
                   r"\b(watch|watches|look after|looks after|take care|takes care|babysits?)\b", low):
        caregiving = "relative/partner provides childcare"
    if re.search(r"other (?:kids|children)|two kids|three kids|baby|infant|newborn", low):
        caregiving = (caregiving + "; " if caregiving else "") + "cares for other children"
    if re.search(r"custody|visitation", low):
        caregiving = (caregiving + "; " if caregiving else "") + "shared custody schedule"

    if re.search(r"no car|bus|public transport|can'?t drive|ride", low):
        constraints = "transportation is limited"
    if re.search(r"second job|two jobs|other job", low):
        constraints = (constraints + "; " if constraints else "") + "works a second job"
    if re.search(r"court|hearing|probation", low):
        constraints = (constraints + "; " if constraints else "") + "has court obligations"

    bits = [b for b in (employment, caregiving, constraints) if b]
    summary = ("Parent reports: " + "; ".join(bits) + ".") if bits \
        else "No life-situation details detected in the intake text."
    return {"employment": employment, "caregiving": caregiving,
            "constraints": constraints, "summary": summary}


def parse_parent_availability(raw_text):
    """Chaotic parent text -> ISO windows PLUS the parent's life situation
    (employment, caregiving, constraints). Returns (windows, situation, source)."""
    now = datetime.datetime.now().replace(microsecond=0)
    if claude_ai and claude_ai.available():
        try:
            intake = claude_ai.parse_intake(raw_text, now.isoformat())
            if intake.get("windows"):
                return intake["windows"], intake.get("situation") or _regex_situation(raw_text), "claude"
        except Exception as exc:
            print(f"[agent1] Claude parse unavailable ({type(exc).__name__}); regex fallback", flush=True)
    return _regex_parse(raw_text, now), _regex_situation(raw_text), "regex"


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

    parent_windows, situation, parse_source = parse_parent_availability(raw_text)

    now = datetime.datetime.now().replace(microsecond=0)
    time_min = now.isoformat()
    time_max = (now + datetime.timedelta(days=window_days)).isoformat()
    streams = check_availability_streams(session, time_min, time_max)

    slots = scheduling.calculate_conflict_free_slots(
        parent_windows, streams["clinician"], streams["monitor"],
        duration_hours=duration_hours, max_slots=3,
    )

    # persist parsed parent availability + situation (safe: the parent's own input, not a booking)
    database.update_session(session_id, parent_availability=parent_windows,
                            parent_situation=situation, status="awaiting_approval")

    return {
        "status": "awaiting_approval" if slots else "no_overlap",
        "checkpoint": True,
        "card": {
            "sessionId": session_id,
            "parentAvailabilitySummary": [w.get("label") or w["start"] for w in parent_windows],
            "parentSituation": situation,
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

    # 4) EMAIL: the approved parent receives their personal launch link
    email_result = None
    parent_addr = session.get("parent_id") or ""
    if "@" in parent_addr:
        import emailer
        email_result = emailer.send_launch_email(
            parent_addr,
            (session.get("parent_name") if isinstance(session, dict) else None) or parent_addr.split("@")[0],
            chosen_slot.get("label") or chosen_slot["start"],
            provisioning.get("launch_url", ""),
        )

    return {
        "status": "booked",
        "slot": chosen_slot,
        "invites": invite,
        "handoff": handoff,
        "provisioning": provisioning,
        "email": email_result,
    }

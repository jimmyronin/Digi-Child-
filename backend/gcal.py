"""
Google Calendar integration for Agent 1 (Intake & Logistics Coordinator).

Two responsibilities:
  1. check_availability_streams -> pull real-time BUSY blocks for the clinician
     and court-monitor calendars (Google Calendar freebusy API).
  2. dispatch_invites -> write the confirmed booking to the calendars and send
     invites to all three parties.

DEMO MODE: if Google credentials or the google-api libraries are unavailable,
`available()` returns False and the coordinator uses the mock availability
streams stored on the session instead. This lets the full loop run end-to-end
tonight without authenticating Google -- swapping to live calendars is then a
credentials-only change, no code edits.

To go live, drop an OAuth client at backend/credentials.json (or set
GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON) and set
GOOGLE_CALENDAR_ENABLED=1.
"""

import os
import datetime

_HERE = os.path.dirname(os.path.abspath(__file__))
_TOKEN_PATH = os.path.join(_HERE, "token.json")
_OAUTH_CLIENT_PATH = os.path.join(_HERE, "credentials.json")
_SCOPES = ["https://www.googleapis.com/auth/calendar"]

_service = None
_service_error = None


def enabled():
    """Has the operator opted into live Google Calendar?"""
    if os.environ.get("GOOGLE_CALENDAR_ENABLED", "").lower() in ("0", "false", "no", ""):
        # default OFF unless explicitly enabled
        return os.environ.get("GOOGLE_CALENDAR_ENABLED", "").lower() in ("1", "true", "yes")
    return True


def _build_service():
    """Build an authorized Google Calendar service, or raise."""
    global _service, _service_error
    if _service is not None:
        return _service
    if _service_error is not None:
        raise _service_error
    try:
        from google.oauth2.credentials import Credentials  # noqa
        from googleapiclient.discovery import build

        creds = None
        # 1) service account (headless / CI)
        sa = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if sa and os.path.exists(sa):
            from google.oauth2 import service_account
            creds = service_account.Credentials.from_service_account_file(sa, scopes=_SCOPES)
        else:
            # 2) installed-app OAuth flow with a cached token
            from google.auth.transport.requests import Request
            if os.path.exists(_TOKEN_PATH):
                creds = Credentials.from_authorized_user_file(_TOKEN_PATH, _SCOPES)
            if not creds or not creds.valid:
                if creds and creds.expired and creds.refresh_token:
                    creds.refresh(Request())
                elif os.path.exists(_OAUTH_CLIENT_PATH):
                    from google_auth_oauthlib.flow import InstalledAppFlow
                    flow = InstalledAppFlow.from_client_secrets_file(_OAUTH_CLIENT_PATH, _SCOPES)
                    creds = flow.run_local_server(port=0)
                    with open(_TOKEN_PATH, "w", encoding="utf-8") as fh:
                        fh.write(creds.to_json())
                else:
                    raise RuntimeError("No Google credentials (credentials.json / service account) found")
        _service = build("calendar", "v3", credentials=creds, cache_discovery=False)
        return _service
    except Exception as exc:
        _service_error = exc
        raise


def available():
    """True if live Google Calendar can actually be used right now."""
    if not enabled():
        return False
    try:
        _build_service()
        return True
    except Exception:
        return False


def _busy_to_free(busy_blocks, time_min_iso, time_max_iso):
    """Invert BUSY blocks into FREE windows within [time_min, time_max]."""
    fmt = lambda d: d.isoformat()
    tmin = datetime.datetime.fromisoformat(time_min_iso.replace("Z", "+00:00"))
    tmax = datetime.datetime.fromisoformat(time_max_iso.replace("Z", "+00:00"))
    busy = []
    for b in busy_blocks:
        try:
            bs = datetime.datetime.fromisoformat(b["start"].replace("Z", "+00:00"))
            be = datetime.datetime.fromisoformat(b["end"].replace("Z", "+00:00"))
            busy.append((bs, be))
        except Exception:
            continue
    busy.sort()
    free, cursor = [], tmin
    for bs, be in busy:
        if bs > cursor:
            free.append({"start": fmt(cursor), "end": fmt(min(bs, tmax))})
        cursor = max(cursor, be)
        if cursor >= tmax:
            break
    if cursor < tmax:
        free.append({"start": fmt(cursor), "end": fmt(tmax)})
    return [w for w in free if w["start"] < w["end"]]


def get_free_windows(calendar_id, time_min_iso, time_max_iso):
    """
    Query the freebusy API for one calendar and return FREE windows
    within [time_min, time_max]. Raises if the live service is unavailable.
    """
    service = _build_service()
    body = {
        "timeMin": time_min_iso,
        "timeMax": time_max_iso,
        "items": [{"id": calendar_id}],
    }
    resp = service.freebusy().query(body=body).execute()
    cal = resp.get("calendars", {}).get(calendar_id, {})
    busy = cal.get("busy", [])
    return _busy_to_free(busy, time_min_iso, time_max_iso)


def dispatch_invites(summary, slot, attendee_emails, description=""):
    """
    Create the booking event on the organizer calendar and invite all parties.
    Returns {dispatched: bool, event_link, source}. Falls back to a mock
    confirmation (no external write) when live calendar is unavailable.
    """
    if not available():
        return {
            "dispatched": False,
            "source": "mock",
            "event_link": None,
            "note": "Demo mode: no live calendar invites sent.",
            "attendees": attendee_emails,
        }
    service = _build_service()
    organizer = os.environ.get("GOOGLE_ORGANIZER_CALENDAR", "primary")
    event = {
        "summary": summary,
        "description": description,
        "start": {"dateTime": slot["start"]},
        "end": {"dateTime": slot["end"]},
        "attendees": [{"email": e} for e in attendee_emails if e and "@" in e],
    }
    created = service.events().insert(
        calendarId=organizer, body=event, sendUpdates="all"
    ).execute()
    return {
        "dispatched": True,
        "source": "google",
        "event_link": created.get("htmlLink"),
        "attendees": attendee_emails,
    }

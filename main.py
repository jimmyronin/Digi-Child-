from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from database import get_state, save_state, log_interaction, get_recent_history
import database
import scheduling
from uuid import uuid4
import os
import sys
import json
import local_ai
import claude_ai
from typing import Optional
import agent1_coordinator as agent1
import agent2_provisioner as agent2

# Import logic from the existing scripts
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from child_agent.brain import get_age_persona

class LogRequest(BaseModel):
    message: str

app = FastAPI(title="Digi-Child Sim API")

@app.post("/api/log")
async def client_log(req: LogRequest):
    print(f"CLIENT LOG: {req.message}", flush=True)
    return {"status": "ok"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Values(BaseModel):
    trust: int
    curiosity: int
    logic: int
    security: int
    autonomy: int
    volatility: int

class Session(BaseModel):
    childId: str
    runId: str

class Tone(BaseModel):
    """Vocal features extracted client-side from the parent's microphone
    (PRD 3b Audio-Stream): what Mira actually HEARS, independent of the words."""
    volume: float = 0.0       # 0..1 mean loudness (RMS)
    peak: float = 0.0         # 0..1 peak loudness
    pitch: float = 0.0        # Hz, mean fundamental
    pitchVar: float = 0.0     # Hz, pitch variability (sharp spikes = agitation)
    sharpness: float = 0.0    # 0..1 spectral centroid (harsh/clipped delivery)
    wordsPerSec: float = 0.0  # speech rate
    jitter: float = 0.0       # 0..1 cycle-to-cycle pitch perturbation (vocal strain)
    shimmer: float = 0.0      # 0..1 cycle-to-cycle amplitude perturbation
    flux: float = 0.0         # 0..1 spectral flux (how violently the timbre changes)
    arousal: float = 0.0      # 0..1 overall activation (energy + rate)
    aggression: float = 0.0   # 0..1 combined client-side aggression score
    esl: bool = False         # parent flagged English as a second language
    source: str = "text"      # "voice" | "text"

class InteractRequest(BaseModel):
    message: str
    day: int
    year: int
    ageBand: str
    mode: str
    location: str
    values: Values
    session: Session
    tone: Optional[Tone] = None

# ---------------------------------------------------------------------------
# Agent: User Language Monitor (PRD 3a) -- pre-filters abusive/derogatory
# language before it reaches the simulation layer.
# ---------------------------------------------------------------------------
TOXIC_WORDS = [
    "stupid", "shut up", "shut it", "hate", "worst", "idiot", "dumb", "ugly",
    "worthless", "useless", "pathetic", "brat", "crybaby", "loser", "freak",
    "good for nothing", "waste of", "wish you were never",
]

def language_monitor(user_input):
    """Returns (treatment, violations): flags toxic language as a mistreatment
    event before the child agent ever sees it."""
    low = user_input.lower()
    violations = [w for w in TOXIC_WORDS if w in low]
    return ("harsh" if violations else "nurturing"), violations


# Governor cool-down withdrawal lines (PRD: "distressed withdrawal" -- the
# child goes quiet or cries softly, forcing the parent to shift strategies)
COOL_DOWN_LINES = [
    "*goes very quiet and turns away, hugging her knees*",
    "*shrinks back and whispers* ...okay. *soft sniffling*",
    "*stares at the floor, shoulders trembling, and says nothing*",
    "*backs away slowly and hides her face* ...",
]

# ESL fairness (professor feedback): accents and second-language prosody can
# read as "tense" to any acoustic model. The FIRST tone flag for an ESL
# speaker becomes a clarification request instead of a scored mistreatment;
# the parent gets a pop-up to explain themselves. Keyed by child_id.
pending_tone_checks = {}



@app.post("/api/interact")
async def interact(req: InteractRequest):
    child_id = req.session.childId
    state = get_state(child_id)

    # Use incoming day/age from UI if it advanced, otherwise keep DB state
    state["day"] = max(state["day"], req.day)
    state["child_age"] = max(state["child_age"], req.year)

    # 1. User Language Monitor: evaluate the WORDS
    treatment, violations = language_monitor(req.message)

    # 1b. Audio dynamics: evaluate the TONE (what the child actually hears).
    # Sweet words in an aggressive voice are still frightening to a child --
    # and they expose "performative parenting" (saying the right things for
    # the evaluator while sounding hostile). PRD 3a/3b.
    tone = req.tone
    tone_aggr = float(tone.aggression) if tone else 0.0
    voice_input = bool(tone and tone.source == "voice")
    is_esl = bool(tone and tone.esl)
    performative = voice_input and treatment == "nurturing" and tone_aggr >= 0.62
    needs_clarification = False
    tone_note = ""
    if voice_input:
        tone_note = (f"loudness {tone.volume:.2f}/1, peak {tone.peak:.2f}/1, "
                     f"vocal sharpness {tone.sharpness:.2f}/1, speech rate {tone.wordsPerSec:.1f} w/s, "
                     f"aggression score {tone_aggr:.2f}/1")
        if tone.jitter or tone.shimmer or tone.flux:
            tone_note += (f", jitter {tone.jitter:.2f}, shimmer {tone.shimmer:.2f}, "
                          f"spectral flux {tone.flux:.2f}")
        if performative and is_esl and not pending_tone_checks.get(child_id):
            # ESL first flag: ask, don't score. The pop-up lets them explain.
            pending_tone_checks[child_id] = True
            performative = False
            needs_clarification = True
            tone_note += (" -- TONE CHECK (ESL): delivery read as aggressive, but the parent speaks "
                          "English as a second language; asked to clarify before scoring")
        elif performative:
            treatment = "harsh"  # the child believes the tone, not the words
            tone_note += " -- INCONGRUENT: warm words delivered in an aggressive voice"
            if is_esl:
                tone_note += " (repeated after ESL tone check)"
            needs_clarification = True  # scored, but the parent may still appeal
        elif treatment == "nurturing" and tone_aggr >= 0.5:
            tone_note += " -- tense undertone"
            needs_clarification = True  # even genuinely tense people get to explain
        if treatment == "nurturing" and tone_aggr < 0.5:
            pending_tone_checks.pop(child_id, None)  # calm turn clears the ESL check

    # 2. Governor Logic: Adjust Values
    if treatment == "harsh":
        state["trust"] = max(0, state["trust"] - 15)
        state["security"] = max(0, state["security"] - 10)
        state["volatility"] = min(100, state["volatility"] + 15)
        state["consecutive_mistreatments"] = state.get("consecutive_mistreatments", 0) + 1
        if performative:
            development_note = ("TONE-WORD INCONGRUENCE: the parent's words were superficially warm, "
                                "but vocal analysis shows an aggressive delivery (" + tone_note + "). "
                                "Scored as mistreatment -- performative parenting indicator for clinical review.")
        else:
            development_note = "The child reacted negatively to harsh input."
        if violations:
            development_note += f" Language Monitor flagged: {', '.join(violations)}."
    else:
        state["trust"] = min(100, state["trust"] + 5)
        state["security"] = min(100, state["security"] + 5)
        state["volatility"] = max(0, state["volatility"] - 5)
        state["consecutive_mistreatments"] = 0
        development_note = "The child responded well to explanation and emotional consistency."
        
    # Location modifiers
    if req.location == "park":
        state["curiosity"] = min(100, state["curiosity"] + 2)
    elif req.location == "home":
        state["security"] = min(100, state["security"] + 2)

    # Trigger Transgression check
    if state.get("consecutive_mistreatments", 0) >= 2 or state["trust"] < 40:
        state["temperament"] = "transgressed"
        mood = "resistant"
    elif state["trust"] >= 80:
        state["temperament"] = "secure"
        mood = "happy"
    else:
        state["temperament"] = "neutral"
        mood = "curious"

    save_state(child_id, state)

    monitor_note = development_note if treatment == "harsh" else ""

    # 2b. CONFLICT GOVERNOR INTERCEPT (PRD 3a/4): if high-friction turns pile up
    # (>= 3 consecutive mistreatments) or the audio itself signals excessive
    # aggression, BLOCK normal child-agent generation and inject the Cool Down
    # state: a distressed withdrawal that forces the parent to change strategy.
    governor = {"intervened": False}
    if state.get("consecutive_mistreatments", 0) >= 3 or (voice_input and tone_aggr >= 0.8):
        reason = ("3+ consecutive high-friction turns"
                  if state.get("consecutive_mistreatments", 0) >= 3
                  else f"vocal aggression {tone_aggr:.2f} exceeded the safety threshold")
        governor = {"intervened": True, "reason": reason, "state": "cool_down"}
        import random as _r
        child_line = _r.choice(COOL_DOWN_LINES)
        log_interaction(child_id, state["day"], req.location, req.message, "governor_intercept",
                        child_line, tone_note=tone_note, tone_aggression=tone_aggr)
        return {
            "childLine": child_line,
            "mood": "withdrawn",
            "action": {"type": "hide", "prop": "none", "spot": "none"},
            "governor": governor,
            "toneRead": tone_note or None,
            "needsClarification": True,
            "developmentNote": ("GOVERNOR INTERVENTION (" + reason + "): the child has entered a "
                                "protective withdrawal. Standard responses are suspended until the "
                                "parent de-escalates -- try a soft voice, validation, and repair. "
                                + monitor_note),
            "values": {
                "trust": state["trust"], "curiosity": state["curiosity"], "logic": state["logic"],
                "security": state["security"], "autonomy": state["autonomy"], "volatility": state["volatility"],
            },
            "visuals": {"expression": "withdrawn", "posture": "closed", "roomTone": "cold"},
        }

    # 3. Child Agent Logic (Brain)
    persona = get_age_persona(state["child_age"], state["temperament"])
    history = get_recent_history(child_id, limit=6)

    ai_response = None
    if claude_ai.available():
        try:
            ai_response = claude_ai.generate_child_response(
                state, req, treatment, history, persona=persona, tone_note=tone_note)
            if ai_response.get("mood"):
                mood = ai_response["mood"]
        except Exception as e:
            print("Claude AI error, falling back to local:", e)

    if not ai_response:
        ai_response = local_ai.generate_child_response(state, req, treatment, history)

    child_line = ai_response.get("childLine", "...")

    development_note = f"REASONING: {ai_response.get('reasoning', '')}\n\nCITATION: {ai_response.get('framework_cited', '')}"
    if monitor_note:
        development_note = monitor_note + "\n\n" + development_note

    log_interaction(child_id, state["day"], req.location, req.message, treatment,
                    child_line, tone_note=tone_note, tone_aggression=tone_aggr)

    return {
        "childLine": child_line,
        "mood": mood,
        "action": ai_response.get("action"),
        "governor": governor,
        "toneRead": tone_note or None,
        "needsClarification": needs_clarification,
        "developmentNote": development_note,
        "values": {
            "trust": state["trust"],
            "curiosity": state["curiosity"],
            "logic": state["logic"],
            "security": state["security"],
            "autonomy": state["autonomy"],
            "volatility": state["volatility"]
        },
        "visuals": {
            "expression": "focused",
            "posture": "open",
            "roomTone": "warm"
        }
    }

# ---------------------------------------------------------------------------
# Tone appeal: flagged parents (ESL or genuinely tense speakers) explain
# themselves. The explanation goes on the clinical record for the case
# manager; a clarified tone-only strike is softened by one.
# ---------------------------------------------------------------------------
class ToneClarifyReq(BaseModel):
    childId: str
    explanation: str = ""
    recalibrated: bool = False  # parent asserted "I was calm" and reset their baseline


@app.post("/api/tone/clarify")
async def api_tone_clarify(req: ToneClarifyReq):
    child_id = req.childId
    state = get_state(child_id)
    note = "PARENT CLARIFICATION: " + (req.explanation.strip() or "(no text given)")
    if req.recalibrated:
        note += " [parent reports calm delivery; personal tone baseline recalibrated]"
    softened = False
    if state.get("consecutive_mistreatments", 0) > 0:
        state["consecutive_mistreatments"] -= 1
        softened = True
        note += " -- one tone-based strike softened pending case-manager review"
        save_state(child_id, state)
    log_interaction(child_id, state["day"], "clarification", req.explanation.strip() or "(recalibrated)",
                    "tone_clarification", "", tone_note=note, tone_aggression=0.0)
    pending_tone_checks.pop(child_id, None)
    return {"status": "ok", "softened": softened,
            "message": "Your explanation was added to the session record for your case manager."}


# ---------------------------------------------------------------------------
# Live Clinical Advisor for the case-manager console: consultation grounded in
# the same ten-book library Mira reasons from. Claude generates it when the
# session state changes (cached so the 3s poll doesn't spam the API); a
# rule-based advisor that still cites the books covers demo mode.
# ---------------------------------------------------------------------------
advice_cache = {}  # child_id -> {"sig": ..., "advice": {...}}


def fallback_case_advice(metrics, tone_flags):
    """Demo-mode advisor: rule-based, but still grounded in the ten books."""
    mistreat = metrics.get("consecutive_mistreatments", 0)
    temperament = metrics.get("temperament", "neutral")
    has_incongruence = any("INCONGRUENT" in f for f in tone_flags)
    has_esl_check = any("TONE CHECK (ESL)" in f for f in tone_flags)

    if has_incongruence:
        return {
            "advice": ("The parent's words are warm but the vocal delivery is aggressive -- the classic "
                       "performative pattern. The child responds to tone, not vocabulary. Watch whether the "
                       "parent can regulate their own state before the next exchange; consider pausing if "
                       "the incongruence repeats."),
            "framework_cited": "Parenting from the Inside Out (Siegel & Hartzell)",
            "risk": "high", "source": "rules",
        }
    if temperament == "transgressed" or mistreat >= 2:
        return {
            "advice": ("The child has shut down after repeated high-friction turns -- her 'upstairs brain' "
                       "is offline, so reasoning with her will fail. Watch for the parent to connect before "
                       "redirecting: soft voice, name the feeling, offer a real choice. If escalation "
                       "continues, pause the session."),
            "framework_cited": "The Whole-Brain Child (Siegel & Bryson)",
            "risk": "high", "source": "rules",
        }
    if has_esl_check:
        return {
            "advice": ("The tone monitor flagged vocal tension, but this parent speaks English as a second "
                       "language, so prosody may read hotter than intended. A clarification was requested "
                       "instead of a scored strike -- review their explanation and weigh the words, the "
                       "pattern, and the child's response together."),
            "framework_cited": "Between Parent and Child (Ginott)",
            "risk": "elevated", "source": "rules",
        }
    if temperament == "secure":
        return {
            "advice": ("Trust is high and the child is responsive. Reinforce what is working: the parent "
                       "explaining the 'why' behind instructions and offering choices. This is the window "
                       "to practice firm-and-kind boundary setting."),
            "framework_cited": "Positive Discipline (Nelsen)",
            "risk": "low", "source": "rules",
        }
    return {
        "advice": ("Interaction is within normal parameters. Watch for acknowledgment of the child's "
                   "feelings before instructions -- acknowledgment earns cooperation, while commands and "
                   "labels provoke resistance at this developmental stage."),
        "framework_cited": "How to Talk So Kids Will Listen (Faber & Mazlish)",
        "risk": "low", "source": "rules",
    }


def get_case_advice(child_id, metrics, history):
    """Return advisor consultation, regenerating only when the session state
    actually changes (the console polls every ~3 seconds)."""
    tone_flags = [h["toneNote"] for h in history
                  if h.get("toneNote") and ("INCONGRUENT" in h["toneNote"] or "TONE CHECK" in h["toneNote"]
                                            or "tense undertone" in h["toneNote"]
                                            or h.get("treatment") == "tone_clarification")]
    sig = (metrics.get("consecutive_mistreatments", 0), metrics.get("temperament"),
           len(history), len(tone_flags))
    cached = advice_cache.get(child_id)
    if cached and cached["sig"] == sig:
        return cached["advice"]

    advice = None
    if claude_ai.available() and history:
        try:
            advice = claude_ai.generate_case_advice(metrics, history, tone_flags)
        except Exception as e:
            print("Claude advisor error, falling back to rules:", e)
    if not advice:
        advice = fallback_case_advice(metrics, tone_flags)
    advice_cache[child_id] = {"sig": sig, "advice": advice}
    return advice


class CreateSessionReq(BaseModel):
    parent_id: str
    clinician_id: str
    monitor_id: str
    clinician_avail: list
    monitor_avail: list
    temperament_profile: str = "cooperative"
    child_age: int = 5

class ParentAvailReq(BaseModel):
    session_id: str
    parent_avail: list

class SessionControlReq(BaseModel):
    session_id: str
    action: str

session_controls = {}

@app.post("/api/schedule/create")
async def api_create_session(req: CreateSessionReq):
    session_id = str(uuid4())[:8] # short id
    database.create_session(
        session_id, req.parent_id, req.clinician_id, req.monitor_id,
        parent_avail=[], clinician_avail=req.clinician_avail, monitor_avail=req.monitor_avail,
        temperament_profile=req.temperament_profile,
        child_age=req.child_age
    )
    return {"status": "ok", "sessionId": session_id}

@app.post("/api/schedule/availability")
async def api_submit_parent_availability(req: ParentAvailReq):
    session = database.get_session(req.session_id)
    if not session:
        return {"status": "error", "message": "Session not found"}
    
    database.update_session(req.session_id, parent_availability=req.parent_avail)
    
    # Run matching logic
    match = scheduling.find_overlap(
        req.parent_avail,
        session["clinician_availability"],
        session["monitor_availability"]
    )
    
    if match:
        database.update_session(
            req.session_id,
            status="scheduled",
            scheduled_time=match["start"]
        )
        return {"status": "booked", "match": match}
    
    database.update_session(req.session_id, status="pending_match")
    return {"status": "pending_match", "message": "No overlapping slot found yet."}

@app.get("/api/schedule/sessions")
async def api_list_sessions():
    return {"sessions": database.list_all_sessions()}

# ======================================================================
#  Two-agent orchestration (professor's architecture)
#   Agent 1: Intake & Logistics Coordinator  ->  human-in-the-loop card
#   Agent 2: Simulation Sandbox Provisioner   ->  auto-handoff on approval
# ======================================================================
class IntakeReq(BaseModel):
    session_id: str
    raw_text: str
    window_days: int = 14

class DecisionReq(BaseModel):
    session_id: str
    approve: bool
    chosen_slot: Optional[dict] = None

# ======================================================================
#  Public enrollment (intro page): parents register + pick among the
#  team's ACTUALLY available dates; a case manager approves the person;
#  the parent then receives the launch email. (User flow, 2026-07-12)
# ======================================================================
def _mock_team_streams(days=14):
    """Clinician + court-monitor availability offered to enrolling parents
    (replaced by live Google Calendar streams when configured)."""
    from datetime import datetime, timedelta
    clin, mon = [], []
    base = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    for i in range(1, days + 1):
        d = base + timedelta(days=i)
        if d.weekday() >= 5:
            continue  # weekends off
        if d.weekday() in (1, 3):  # clinician does full days Tue/Thu
            clin.append({"start": d.replace(hour=9).isoformat(), "end": d.replace(hour=17).isoformat()})
        else:
            clin.append({"start": d.replace(hour=9).isoformat(), "end": d.replace(hour=12).isoformat()})
        if d.weekday() != 4:  # monitor off on Fridays
            mon.append({"start": d.replace(hour=10).isoformat(), "end": d.replace(hour=15).isoformat()})
    return clin, mon


class RegisterReq(BaseModel):
    name: str
    email: str
    child_age: int = 5
    slots: list  # the parent's chosen windows [{start, end, label}]
    situation: str = ""  # free text: employment, pickups, anything affecting timing
    esl: bool = False    # English is a second language -> lenient tone flagging


@app.get("/api/register/options")
async def api_register_options():
    """Every open, conflict-free hour the parent can choose among -- the full
    clinician ∩ monitor free grid, so the calendar shows a real week's shape."""
    from datetime import datetime, timedelta
    clin, mon = _mock_team_streams()

    def _windows(wins):
        return [(datetime.fromisoformat(w["start"]), datetime.fromisoformat(w["end"])) for w in wins]

    slots = []
    for cs, ce in _windows(clin):
        for ms, me in _windows(mon):
            lo, hi = max(cs, ms), min(ce, me)
            h = lo.replace(minute=0, second=0, microsecond=0)
            if h < lo:
                h += timedelta(hours=1)
            while h + timedelta(hours=1) <= hi:
                slots.append({
                    "start": h.isoformat(),
                    "end": (h + timedelta(hours=1)).isoformat(),
                    "label": h.strftime("%a %b %d, %I:%M %p").replace(" 0", " "),
                })
                h += timedelta(hours=1)
    slots.sort(key=lambda s: s["start"])
    return {"slots": slots}


@app.post("/api/register/parent")
async def api_register_parent(req: RegisterReq):
    email_addr = req.email.strip().lower()
    if "@" not in email_addr:
        return {"status": "error", "message": "Please enter a valid email address."}
    if not req.slots:
        return {"status": "error", "message": "Please pick at least one session time."}

    clin, mon = _mock_team_streams()
    session_id = str(uuid4())[:8]
    database.create_session(
        session_id, email_addr, "clinician_naquan", "monitor_jimmy",
        parent_avail=req.slots, clinician_avail=clin, monitor_avail=mon,
        temperament_profile="cooperative", child_age=req.child_age,
    )
    # understand the parent's life situation from their own words (Agent 1's
    # situation reader: Claude when available, keyword scan in demo mode)
    situation = {}
    if req.situation.strip():
        _, situation, _src = agent1.parse_parent_availability(req.situation.strip())

    database.update_session(
        session_id,
        parent_name=req.name.strip(),
        parent_situation=situation,
        esl=1 if req.esl else 0,
        status="awaiting_approval",
    )

    return {
        "status": "registered",
        "sessionId": session_id,
        "message": ("Enrollment received! Your case manager will review your information and "
                    "approve a session. You'll get an email with your personal launch link."),
    }


@app.get("/api/register/status")
async def api_register_status(email: str):
    """Parents check where their enrollment stands (and get their launch link
    once approved -- the demo-mode mirror of the email)."""
    email_addr = email.strip().lower()
    mine = [s for s in database.list_all_sessions() if (s.get("parent_id") or "").lower() == email_addr]
    if not mine:
        return {"status": "not_found", "message": "No enrollment found for that email."}
    rank = {"live": 4, "live_paused": 4, "scheduled": 3, "awaiting_approval": 2, "pending_outreach": 1}
    s = sorted(mine, key=lambda x: rank.get(x.get("status"), 0), reverse=True)[0]
    out = {
        "status": s.get("status"),
        "sessionId": s.get("session_id"),
        "scheduled_time": s.get("scheduled_time"),
        "name": s.get("parent_name") or "",
    }
    if s.get("status") in ("live", "live_paused"):
        out["launch_url"] = f"{agent2.SIM_BASE_URL}/?session={s['session_id']}&loc=home"
    return out


@app.post("/api/agent1/intake")
async def api_agent1_intake(req: IntakeReq):
    """Agent 1: parse chaotic parent text -> pull clinician/monitor streams ->
    calculate 2-3 conflict-free slots -> return the approval card. Writes no
    booking and dispatches no invites (the human-in-the-loop checkpoint)."""
    return agent1.propose(req.session_id, req.raw_text, window_days=req.window_days)

@app.post("/api/agent1/decision")
async def api_agent1_decision(req: DecisionReq):
    """Clinical Case Manager's decision. Approve -> Agent 1 books the slot,
    dispatches invites, and hands off to Agent 2 which provisions the sandbox.
    Reject -> clean termination with zero side effects."""
    if req.approve:
        return agent1.confirm(req.session_id, req.chosen_slot)
    return agent1.reject(req.session_id)

@app.get("/api/agent1/review")
async def api_agent1_review(sessionId: str):
    """Re-fetch stored proposal data for an awaiting_approval session so the
    clinician can re-open the approval card after navigating away or refreshing."""
    session = database.get_session(sessionId)
    if not session:
        return {"status": "error", "message": "Session not found"}
    if session["status"] != "awaiting_approval":
        return {"status": "error", "message": f"Session is {session['status']}, not awaiting_approval"}

    parent_windows = session.get("parent_availability", [])
    clinician_windows = session.get("clinician_availability", [])
    monitor_windows = session.get("monitor_availability", [])

    slots = scheduling.calculate_conflict_free_slots(
        parent_windows, clinician_windows, monitor_windows,
        duration_hours=1, max_slots=3,
    )

    return {
        "status": "awaiting_approval",
        "checkpoint": True,
        "sessionId": sessionId,
        "parentAvailabilitySummary": [w.get("label") or w.get("start", "") for w in parent_windows],
        "parentSituation": session.get("parent_situation") or {},
        "parentName": session.get("parent_name") or "",
        "esl": bool(session.get("esl")),
        "proposedSlots": slots,
        "calendarOverlay": {
            "parent": parent_windows,
            "clinician": clinician_windows,
            "monitor": monitor_windows,
        },
        "sources": {"parse": "stored", "streams": "stored"},
    }

@app.post("/api/session/control")
async def api_control_session(req: SessionControlReq):
    session = database.get_session(req.session_id)
    if not session:
        return {"status": "error", "message": "Session not found"}
        
    if req.action == "pause":
        session_controls[req.session_id] = {"paused": True}
        database.update_session(req.session_id, status="live_paused")
    elif req.action == "resume":
        session_controls[req.session_id] = {"paused": False}
        database.update_session(req.session_id, status="live")
    elif req.action == "complete":
        session_controls[req.session_id] = {"paused": False}
        database.update_session(req.session_id, status="completed")
        
    return {"status": "ok", "state": session_controls.get(req.session_id, {"paused": False})}

@app.get("/api/session/status")
async def api_session_status(sessionId: str):
    session = database.get_session(sessionId)
    if not session:
        return {"status": "error", "message": "Session not found"}
    ctrl = session_controls.get(sessionId, {"paused": False})
    
    # Also fetch current parent state metrics
    parent_state = dict(database.get_state(session["parent_id"]))
    parent_state["child_age"] = session.get("child_age", 5)
    history = database.get_history_with_tone(session["parent_id"], limit=20)

    # tone & voice flags for the console (incongruence, ESL checks, clarifications)
    tone_flags = [
        {"time": h["time"], "parent": h["parent"], "note": h["toneNote"],
         "aggression": h["toneAggression"], "treatment": h["treatment"]}
        for h in history
        if (h.get("toneNote") and ("INCONGRUENT" in h["toneNote"] or "TONE CHECK" in h["toneNote"]
                                   or "tense undertone" in h["toneNote"]))
        or h.get("treatment") in ("tone_clarification", "governor_intercept")
    ]

    return {
        "status": session["status"],
        "paused": ctrl["paused"],
        "metrics": parent_state,
        "history": history,
        "toneFlags": tone_flags,
        "advice": get_case_advice(session["parent_id"], parent_state, history),
        "parentSituation": session.get("parent_situation") or {},
        "esl": bool(session.get("esl")),
    }

@app.post("/api/session/provision")
async def api_provision_session(req: SessionControlReq):
    session = database.get_session(req.session_id)
    if not session:
        return {"status": "error", "message": "Session not found"}
    
    # Load parent's history or init
    parent_state = database.get_state(session["parent_id"])
    
    # Overwrite profile and initialize metrics accordingly
    prof = session.get("temperament_profile", "cooperative")
    parent_state["temperament_profile"] = prof
    parent_state["child_age"] = session.get("child_age", 5)
    
    if prof == "oppositional":
        parent_state["volatility"] = 75
        parent_state["trust"] = 40
        parent_state["temperament"] = "transgressed"
        parent_state["consecutive_mistreatments"] = 0
    elif prof == "withdrawn":
        parent_state["volatility"] = 25
        parent_state["trust"] = 30
        parent_state["temperament"] = "neutral"
        parent_state["consecutive_mistreatments"] = 0
    else: # cooperative
        parent_state["volatility"] = 10
        parent_state["trust"] = 80
        parent_state["temperament"] = "secure"
        parent_state["consecutive_mistreatments"] = 0
        
    database.save_state(session["parent_id"], parent_state)
    
    # Set status to live and save snapshot
    database.update_session(
        req.session_id,
        status="live",
        state_json_snapshot=json.dumps(parent_state)
    )
    session_controls[req.session_id] = {"paused": False}
    return {"status": "ok", "state": parent_state}

@app.get("/api/session/report")
async def api_session_report(sessionId: str):
    session = database.get_session(sessionId)
    if not session:
        return {"status": "error", "message": "Session not found"}
        
    parent_state = database.get_state(session["parent_id"])
    history = database.get_recent_history(session["parent_id"], limit=100)
    
    # Compile a beautiful, structured text report
    report = []
    report.append("==================================================")
    report.append("  DIGI-CHILD SIMULATION CLINICAL SESSION REPORT   ")
    report.append("==================================================")
    report.append(f"Session ID:       {session['session_id']}")
    report.append(f"Parent ID:        {session['parent_id']}")
    report.append(f"Clinician ID:     {session['clinician_id']}")
    report.append(f"Court Monitor ID: {session['monitor_id']}")
    report.append(f"Scheduled Time:   {session['scheduled_time']}")
    report.append(f"Session Status:   {session['status']}")
    report.append(f"Temperament Profile: {session.get('temperament_profile', 'cooperative').upper()}")
    report.append("--------------------------------------------------")
    report.append("FINAL BEHAVIORAL METRICS:")
    report.append(f"  Trust Level:     {parent_state['trust']}/100")
    report.append(f"  Volatility:      {parent_state['volatility']}/100")
    report.append(f"  Security:        {parent_state['security']}/100")
    report.append(f"  Curiosity:       {parent_state['curiosity']}/100")
    report.append(f"  Autonomy:        {parent_state['autonomy']}/100")
    report.append(f"  Logic:           {parent_state['logic']}/100")
    report.append(f"  Consecutive Mistreatments: {parent_state.get('consecutive_mistreatments', 0)}")
    report.append(f"  Assessment Temperament:   {parent_state['temperament'].upper()}")
    report.append("--------------------------------------------------")
    report.append("CONVERSATION TRANSCRIPT:")
    for idx, h in enumerate(history, 1):
        report.append(f"  [{idx}] PARENT: {h['parent']}")
        report.append(f"      CHILD:  {h['mira']}")
    report.append("==================================================")
    
    return {"status": "ok", "reportText": "\n".join(report)}


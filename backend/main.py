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

class InteractRequest(BaseModel):
    message: str
    day: int
    year: int
    ageBand: str
    mode: str
    location: str
    values: Values
    session: Session

def evaluate_input(user_input):
    harsh_words = ["stupid", "shut up", "hate", "bad", "worst", "ignore"]
    input_lower = user_input.lower()
    for word in harsh_words:
        if word in input_lower:
            return "harsh"
    return "nurturing"



@app.post("/api/interact")
async def interact(req: InteractRequest):
    child_id = req.session.childId
    state = get_state(child_id)
    
    # Use incoming day/age from UI if it advanced, otherwise keep DB state
    state["day"] = max(state["day"], req.day)
    state["child_age"] = max(state["child_age"], req.year)
    
    # 1. Evaluate Parent Input
    treatment = evaluate_input(req.message)
    
    # 2. Governor Logic: Adjust Values
    if treatment == "harsh":
        state["trust"] = max(0, state["trust"] - 15)
        state["security"] = max(0, state["security"] - 10)
        state["volatility"] = min(100, state["volatility"] + 15)
        state["consecutive_mistreatments"] = state.get("consecutive_mistreatments", 0) + 1
        development_note = "The child reacted negatively to harsh input."
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
    
    # 3. Child Agent Logic (Brain)
    persona = get_age_persona(state["child_age"], state["temperament"])
    history = get_recent_history(child_id, limit=6)
    
    ai_response = None
    if claude_ai.available():
        try:
            ai_response = claude_ai.generate_child_response(state, req, treatment, history, persona=persona)
            if ai_response.get("mood"):
                mood = ai_response["mood"]
        except Exception as e:
            print("Claude AI error, falling back to local:", e)
            
    if not ai_response:
        ai_response = local_ai.generate_child_response(state, req, treatment, history)
        
    child_line = ai_response.get("childLine", "...")
    
    development_note = f"REASONING: {ai_response.get('reasoning', '')}\n\nCITATION: {ai_response.get('framework_cited', '')}"
    
    log_interaction(child_id, state["day"], req.location, req.message, treatment, child_line)

    return {
        "childLine": child_line,
        "mood": mood,
        "action": ai_response.get("action"),
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
    history = database.get_recent_history(session["parent_id"], limit=20)
    
    return {
        "status": session["status"],
        "paused": ctrl["paused"],
        "metrics": parent_state,
        "history": history
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


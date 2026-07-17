"""
Agent 2 -- The Simulation Sandbox Provisioner.

The clinical environment engineer. The moment Agent 1's handoff arrives
(session_id, parent_id, scheduled_time), Agent 2:
  1. reaches into the database and extracts the parent's historical state.json
     (baseline trust_level, temperament, consecutive_mistreatments, ...),
  2. calibrates the simulation baseline from the session's temperament profile,
  3. instantiates + pre-loads the live digital therapeutic environment and
     writes the state snapshot so it is fully ready the moment the panel begins,
  4. returns the launch URL for the calibrated sandbox.
"""

import os
import json

import database

# Where the playable simulation is served (the first-person Digi-Child UI).
SIM_BASE_URL = os.environ.get("DIGICHILD_SIM_URL", "http://127.0.0.1:5178").rstrip("/")

# Profile -> starting behavioral baseline the sandbox is calibrated to.
_PROFILE_BASELINES = {
    "oppositional": {"volatility": 75, "trust": 40, "temperament": "transgressed"},
    "withdrawn": {"volatility": 25, "trust": 30, "temperament": "neutral"},
    "cooperative": {"volatility": 10, "trust": 80, "temperament": "secure"},
}


def provision(session_id, parent_id=None, scheduled_time=None):
    """
    Instantiate and pre-load the simulation sandbox for a confirmed session.
    Idempotent: safe to call again if a panel re-launches.
    """
    session = database.get_session(session_id)
    if not session:
        return {"status": "error", "message": "Session not found"}

    parent_id = parent_id or session.get("parent_id")

    # 1) extract the parent's historical state.json
    parent_state = database.get_state(parent_id)

    # 2) calibrate baseline from the assigned temperament profile
    profile = session.get("temperament_profile", "cooperative")
    baseline = _PROFILE_BASELINES.get(profile, _PROFILE_BASELINES["cooperative"])
    parent_state["temperament_profile"] = profile
    parent_state["volatility"] = baseline["volatility"]
    parent_state["trust"] = baseline["trust"]
    parent_state["temperament"] = baseline["temperament"]
    parent_state["consecutive_mistreatments"] = 0
    parent_state["child_age"] = session.get("child_age", 5)
    database.save_state(parent_id, parent_state)

    # 3) instantiate: snapshot the pre-loaded state and flip the environment live
    snapshot = json.dumps(parent_state)
    database.update_session(
        session_id,
        status="live",
        state_json_snapshot=snapshot,
    )

    # 4) hand back the calibrated launch URL
    launch_url = f"{SIM_BASE_URL}/?session={session_id}&loc=home"

    return {
        "status": "provisioned",
        "session_id": session_id,
        "parent_id": parent_id,
        "scheduled_time": scheduled_time or session.get("scheduled_time"),
        "temperament_profile": profile,
        "baseline_state": {
            "trust": parent_state["trust"],
            "volatility": parent_state["volatility"],
            "temperament": parent_state["temperament"],
            "consecutive_mistreatments": parent_state["consecutive_mistreatments"],
        },
        "launch_url": launch_url,
    }

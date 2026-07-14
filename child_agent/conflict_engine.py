# backend/child_agent/conflict_engine.py
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from llm_provider import query_llm

class ConflictGovernor:
    def evaluate_escalation(self, state_data):
        # We pass the state to the LLM to get a "real" decision on escalation
        prompt = "Review this session state. Is the parent spiraling? Respond ONLY with 'NORMAL' or 'FORCE_WITHDRAWAL'."
        return query_llm(prompt, str(state_data))
def trigger_child_behavior(aesthetic_mode):
    # Mapping modes to potential behaviors
    behaviors = {
        "neutral": ["playing quietly", "staring at the wall"],
        "Goth": ["drawing dark sketches on the wall", "muttering to himself"],
        "Emo": ["leaving school tools everywhere", "refusing to listen"],
        "Teen_Issues": ["saying 'no' to everything", "slamming the bedroom door"]
    }
    
    # Return a random behavior based on the mode
    return random.choice(behaviors.get(aesthetic_mode, ["playing"]))

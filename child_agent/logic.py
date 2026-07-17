from child_agent.brain import get_age_persona
from claude_ai import call_claude # Or whichever "cousin" you want to wake up

import json
from backend.claude_ai import call_claude

async def get_thinking_response(user_input, current_state):
    system_prompt = f"""
    You are Mira. Current state: {current_state}. 
    You MUST respond with a JSON object containing two fields:
    1. 'action': A short, descriptive physical action (e.g., 'looks down', 'nods slowly').
    2. 'spoken_response': Your actual dialogue or silence.
    Do not output anything outside of this JSON format.
    """
    
    # Get the raw response from Claude
    raw_response = await call_claude(f"{system_prompt}\nUser: {user_input}")
    
    try:
        # Load the structured JSON response
        data = json.loads(raw_response)
        return data
    except json.JSONDecodeError:
        # Fallback to prevent system crash
        return {"action": "stays quiet", "spoken_response": "..."}

# backend/guardrail.py
from claude_ai import call_claude # Assuming you fix the function name here

async def safe_call_claude(prompt):
    try:
        # Here is where you add your retry logic or error handling
        response = await call_claude(prompt)
        return response
    except Exception as e:
        # If the API drops, this is where the "Agent" intervenes
        print(f"DEBUG: API Call dropped: {e}")
        return "Mira is distracted right now. Try again."# backend/guardrail.py
from claude_ai import call_claude # Assuming you fix the function name here

async def safe_call_claude(prompt):
    try:
        # Here is where you add your retry logic or error handling
        response = await call_claude(prompt)
        return response
    except Exception as e:
        # If the API drops, this is where the "Agent" intervenes
        print(f"DEBUG: API Call dropped: {e}")
        return "Mira is distracted right now. Try again.

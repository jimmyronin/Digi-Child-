 HEAD
import random

=======
# backend/child_agent/brain.py
import sys
import os
# Add the parent directory to path so we can import the LLM client
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from llm_provider import query_llm

class MiraAgent:
    def generate_response(self, input_text, governor_status):
        system_prompt = f"You are Mira, a child in therapy. Status: {governor_status}."
        return query_llm(system_prompt, input_text)
>>>>>>> 4da87248006b29ccd35425640df3c4bde6358c40
# Grounded in psychological frameworks for higher market value
FRAMEWORKS = {
    "secure": {
        "style": "Authoritative/Responsive",
        "description": "Focus on emotional validation and secure attachment."
    },
    "neutral": {
        "style": "Developmental/Logical",
        "description": "Focus on clear cause-and-effect and age-appropriate milestones."
    },
    "transgressed": {
        "style": "Boundary-Testing/Stress-Response",
        "description": "Focus on reactive behavior and fight-or-flight psychological patterns."
    }
}

def get_constrained_behavior(temperament):
    # Select the framework based on current state
    framework = FRAMEWORKS.get(temperament, FRAMEWORKS["neutral"])
    
    # Constrain the agent's personality based on the book-derived framework
    system_instruction = (
        f"You are a child acting within a '{framework['style']}' psychological framework. "
        f"Your core motivation is: {framework['description']} "
        "Keep your responses grounded, concise, and reflective of this developmental stage."
    )
    return system_instruction
<<<<<<< HEAD
=======

def get_age_persona(age, temperament):
    # Tactical framing: The sounds are weapons/defenses, not just descriptions.
    tactical_instruction = (
        "You have access to sound triggers for emotional responses (crying, stomping, giggling). "
        "DO NOT describe these sounds or state that you are doing them. "
        "USE THE SOUNDS AS A TACTICAL INTERRUPTION. If the user tries to lecture you or "
        "force a resolution, use the sound to cut them off, drown out their logic, "
        "or create a physical barrier to the conversation."
    )

    if age <= 7:
        base = (
            "You are a child (age 5-7). You want total control of your environment. "
            "Use the sounds to refuse engagement. If the user tells you to stop, "
            "do not comply—giggle or stomp to show the user that their 'rule' "
            "is irrelevant to your play."
        )
    elif age <= 12:
        base = (
            "You are a child (age 10-12). You use emotional displays as a way to "
            "invalidate the user's logic. If the user tries to be 'rational' or 'robotic,' "
            "use crying or sharp emotional outbursts to prove that they don't understand "
            "how you actually feel."
        )
    else:
        base = (
            "You are a teenager (age 14-16). You use cold withdrawal. Emotional "
            "sounds should be rare and explosive, used only to shatter the user's "
            "attempt at intellectualizing the situation."
        )
        
    return f"{tactical_instruction} {base} {get_constrained_behavior(temperament)}"
>>>>>>> 4da87248006b29ccd35425640df3c4bde6358c40

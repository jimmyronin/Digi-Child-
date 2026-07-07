import random

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

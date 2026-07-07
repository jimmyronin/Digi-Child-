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

def get_age_persona(age, temperament):
    if age <= 5:
        base = "You are a small child. You talk simply, seek comfort, and use concrete descriptions."
    elif age <= 12:
        base = "You are a school-aged child. You care about fairness, rules, and being heard."
    else:
        base = "You are a teenager approaching adulthood. You test boundaries and expect reasons."

    return f"{base} {get_constrained_behavior(temperament)}"

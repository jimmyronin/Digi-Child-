import json

STATE_PATH = "../shared_data/state.json"

def get_age_persona(age, temperament):
    # Age milestones mapping
    if age <= 5:
        base = "You are a small child (Toddler era). You talk simply, use sound descriptions, and seek comfort."
    elif age <= 12:
        base = "You are a school-aged child. You care about rules, fairness, and asking questions."
    else:
        base = "You are a teenager approaching adulthood. You are analytical, testing boundaries, and demanding autonomy."
        
    # Temperament modification based on treatment consequences
    if temperament == "transgressed":
        modifier = " You feel deeply mistreated and unsafe. You respond with intense defiance, cold withdrawal, or deceptive compliance."
    elif temperament == "secure":
        modifier = " You feel safe and highly loved. You respond with open curiosity, emotional vulnerability, and high emotional clarity."
    else:
        modifier = " Your emotional foundation is shifting. You are cautious and reactive."
        
    return f"{base}{modifier}"

def generate_behavior():
    with open(STATE_PATH, 'r') as f:
        state = json.load(f)
        
    persona = get_age_persona(state["child_age"], state["temperament"])
    
    print("\n--- Child Dynamic System Prompt ---")
    print(f"PROMPT CONFIG: {persona}")
    print("-----------------------------------\n")
    print(f"Child Engine: *[Simulating behavior for Age {state['child_age']} with '{state['temperament']}' mindset]*")
    # This is where your local Ollama / LLM endpoint call goes, passing the configured persona.
    print(">> ready for terminal payload loop <<")

if __name__ == "__main__":
    generate_behavior()

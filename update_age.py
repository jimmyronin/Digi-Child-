import json

STATE_PATH = "shared_data/state.json"

def cycle_year():
    with open(STATE_PATH, 'r') as f:
        state = json.load(f)
        
    state["child_age"] += 1
    
    # Habit formation check (The 21-stage stabilization rule)
    if state["temperament"] == "secure" and "healthy_attachment" not in state["habits"]:
        state["habits"].append("healthy_attachment")
    elif state["temperament"] == "transgressed" and "defensive_isolation" not in state["habits"]:
        state["habits"].append("defensive_isolation")
        
    with open(STATE_PATH, 'w') as f:
        json.dump(state, f, indent=2)
        
    print(f"\n[TIME TRANSITION]: 1 Real Day has passed. The Child has aged to Year {state['child_age']}.")
    print(f"Solidified Habits Core: {state['habits']}")

if __name__ == "__main__":
    cycle_year()

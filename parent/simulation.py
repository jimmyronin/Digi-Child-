from child_agent import conflict_engine
import json
import os

STATE_PATH = "../shared_data/state.json"

def load_state():
    with open(STATE_PATH, 'r') as f:
        return json.load(f)

def save_state(state):
    with open(STATE_PATH, 'w') as f:
        json.dump(state, f, indent=2)

def evaluate_input(user_input):
    # Simple keyword metric for MVP. Can scale to a local model classification layer later.
    harsh_words = ["stupid", "shut up", "hate", "bad", "worst", "ignore"]
    input_lower = user_input.lower()
    
    for word in harsh_words:
        if word in input_lower:
            return "harsh"
    return "nurturing"

def main():
    print("=== DIGI-CHILD SIMULATION SYSTEM ===")
    state = load_state()
    print(f"Your child is currently {state['child_age']} years old.")
    print(f"Current Trust Level: {state['trust_level']}% | Personality: {state['temperament']}\n")
    
    user_input = input("You (Parent): ")
    treatment = evaluate_input(user_input)
    
    if treatment == "harsh":
        state["trust_level"] = max(0, state["trust_level"] - 15)
        state["consecutive_mistreatments"] += 1
        print("\n[SYSTEM LOG]: Your input was processed as harmful/harsh. Trust decreased.")
    else:
        state["trust_level"] = min(100, state["trust_level"] + 5)
        state["consecutive_mistreatments"] = 0
        print("\n[SYSTEM LOG]: Your input was processed as nurturing. Trust reinforced.")
        
    # Trigger Transgression check
    if state["consecutive_mistreatments"] >= 2 or state["trust_level"] < 40:
        state["temperament"] = "transgressed"
        print("[SYSTEM LOG]: Warning. Child is demonstrating defensive behavioral anomalies.")
    elif state["trust_level"] >= 80:
        state["temperament"] = "secure"
    else:
        state["temperament"] = "neutral"
        
    save_state(state)
    
    # Hand off to the child agent to formulate a response
    os.system("python3 ../child_agent/brain.py")

if __name__ == "__main__":
    main()

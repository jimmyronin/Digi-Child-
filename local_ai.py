import random
import re

def analyze_parent_input(message):
    message = message.lower()
    if re.search(r'\b(why|how|explain)\b', message):
        return "inquisitive"
    if re.search(r'\b(stop|no|don\'t|quit|bad|stupid|shut up|hate)\b', message):
        return "controlling"
    if re.search(r'\b(love|care|safe|understand|okay|sorry|here for you)\b', message):
        return "nurturing"
    if re.search(r'\b(play|game|fun|toy|let\'s)\b', message):
        return "playful"
    return "neutral"

def generate_child_response(state, req, treatment, history):
    intent = analyze_parent_input(req.message)
    age = req.year
    trust = state.get("trust", 50)
    volatility = state.get("volatility", 50)
    
    framework = "Yardsticks (Wood)"
    reasoning = "Generic age-appropriate response."
    
    if treatment == "harsh" or intent == "controlling":
        framework = "The Explosive Child (Ross Greene)"
        if volatility > 50:
            reasoning = "Parent used control/harshness; child is highly volatile, resulting in an explosive or defensive reaction (Plan A failure)."
            if age <= 7:
                lines = ["NO! I don't want to!", "You're mean! Leave me alone!", "*Throws a toy* No!"]
            elif age <= 12:
                lines = ["You can't make me!", "It's not fair, you never let me do anything!", "I hate this!"]
            else:
                lines = ["Whatever. You don't get it.", "Stop trying to run my life!", "I'm not listening to this."]
        else:
            reasoning = "Parent used control; child is compliant but insecure, causing emotional withdrawal."
            if age <= 7:
                lines = ["*looks down* Okay...", "I'm sorry...", "*cries quietly*"]
            elif age <= 12:
                lines = ["Fine, I'll do it.", "I guess I have to.", "*sighs and walks away*"]
            else:
                lines = ["Okay, whatever.", "Sure, fine.", "I said okay."]
    elif intent == "nurturing":
        framework = "The Whole-Brain Child (Daniel J. Siegel)"
        reasoning = "Parent validated emotions, fostering connection and calming the child's lower brain."
        if trust > 60:
            if age <= 7:
                lines = ["I love you too.", "Can we hug?", "I feel better now.", "Okay!"]
            elif age <= 12:
                lines = ["Thanks for understanding.", "I was just really upset.", "You're right, I'm okay."]
            else:
                lines = ["Thanks.", "I appreciate you saying that.", "Yeah, it's just been a long day."]
        else:
            reasoning = "Parent attempted nurturing, but trust is low. Child is hesitant (Avoidant Attachment)."
            if age <= 7:
                lines = ["Are you sure?", "*sniffles* Really?", "I don't know..."]
            elif age <= 12:
                lines = ["I guess.", "It doesn't feel like it.", "Maybe."]
            else:
                lines = ["Whatever you say.", "It doesn't matter.", "Sure."]
    elif intent == "playful":
        framework = "How to Talk So Kids Will Listen (Adele Faber)"
        reasoning = "Parent used playfulness/engagement to foster cooperation."
        if age <= 7:
            lines = ["Yay! Let's play!", "I want the red one!", "Look what I can do!"]
        elif age <= 12:
            lines = ["Okay, that sounds fun.", "Can we do it my way?", "Awesome!"]
        else:
            lines = ["Sure, I'm down.", "If you want.", "Sounds good."]
    elif intent == "inquisitive":
        framework = "Parenting from the Inside Out (Daniel J. Siegel)"
        reasoning = "Parent asked questions; child responds based on their level of autonomy and trust."
        if trust > 50:
            if age <= 7:
                lines = ["Because I like it!", "I don't know, it's just fun!", "Look at this!"]
            elif age <= 12:
                lines = ["I was just thinking about stuff.", "Because it makes sense to me.", "Let me show you."]
            else:
                lines = ["Just because.", "It's a long story.", "I read about it online."]
        else:
            lines = ["I don't know.", "Nothing.", "Leave it alone.", "Stop asking me."]
    else:
        framework = "Yardsticks: Child and Adolescent Development (Chip Wood)"
        reasoning = "Parent provided neutral input. Child responds based on baseline developmental temperament."
        if age <= 7:
            lines = ["Okay!", "What are we doing?", "Look!"]
        elif age <= 12:
            lines = ["Alright.", "What's next?", "I'm bored."]
        else:
            lines = ["Hmm.", "Okay.", "Right."]

    selected_line = random.choice(lines)
    
    # Temperament Profile Overrides
    profile = state.get("temperament_profile", "cooperative")
    if profile == "oppositional" and intent != "nurturing":
        framework = "The Explosive Child (Ross Greene)"
        reasoning = "Child has an Oppositional Temperament Profile and parent did not use nurturing de-escalation."
        if age <= 7:
            selected_line = random.choice(["No way!", "I hate that!", "Make me!", "*Stamps feet* I won't!"])
        elif age <= 12:
            selected_line = random.choice(["You're not the boss of me!", "Why should I listen to you?", "This is stupid! I don't care."])
        else:
            selected_line = random.choice(["Stop talking to me.", "Whatever. You're just trying to control me.", "I'm going to do what I want anyway."])
            
    elif profile == "withdrawn" and intent != "nurturing":
        framework = "Attachment Theory (Bowlby)"
        reasoning = "Child has a Withdrawn/Avoidant Temperament Profile."
        if age <= 7:
            selected_line = random.choice(["*turns away*", "...okay...", "*shrugs and stays quiet*"])
        elif age <= 12:
            selected_line = random.choice(["I guess.", "*stares at floor*", "Leave me alone."])
        else:
            selected_line = random.choice(["Don't talk to me.", "It doesn't matter.", "*shuts door / looks away*"])
            
    return {
        "childLine": selected_line,
        "reasoning": reasoning,
        "framework_cited": framework
    }

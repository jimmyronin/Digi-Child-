class MonitorAgent:
    def is_safe(self, text):
        # Placeholder: blocks known toxic phrases (e.g., 'hate', 'stupid')
        toxic_keywords = ["hate", "stupid", "dumb"]
        return not any(word in text.lower() for word in toxic_keywords)

    def trigger_warning(self, state):
        return {"childLine": "I don't like it when you use those words.", "mood": "guarded"}
from llm_provider import query_llm
class MonitorAgent:
    def is_safe(self, text):
        prompt = "You are a safety filter. Analyze if the text is toxic for a therapy session. Respond ONLY 'SAFE' or 'UNSAFE'."
        return "SAFE" in query_llm(prompt, text)


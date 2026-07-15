class Governor:
    def check_status(self, state):
        # Placeholder: checks if consecutive_mistreatments > 3
        if state.get("consecutive_mistreatments", 0) > 3:
            return "FORCE_WITHDRAWAL"
        return "NORMAL"
from llm_provider import query_llm
class Governor:
    def check_status(self, state_json):
        prompt = "You are a Conflict Governor. Review state. If consecutive_mistreatments >= 3, output 'FORCE_WITHDRAWAL', otherwise 'NORMAL'."
        return query_llm(prompt, str(state_json))

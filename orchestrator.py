from monitor import MonitorAgent
from governor import Governor
# from child_agent.logic import get_thinking_response

monitor_agent = MonitorAgent()
conflict_governor = Governor()

from child_agent.conflict_engine import ConflictGovernor
from child_agent.brain import MiraAgent

governor = ConflictGovernor()
mira = MiraAgent()

# Now your orchestrator loop uses the real agents
async def process_parent_input(user_input, state):
    status = governor.evaluate_escalation(state)
    response = mira.generate(user_input, status)
    return response

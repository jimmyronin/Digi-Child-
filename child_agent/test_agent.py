import asyncio
from child_agent.orchestrator import get_thinking_response

async def test():
    # Test age 5 (the "Stomping/Control" stage)
    # Temperament "transgressed" (the "Boundary-Testing" stage)
    response = await get_thinking_response("Stop drawing on the wall right now.", age=5, temperament="transgressed")
    print(f"Mira's Response: {response}")

if __name__ == "__main__":
    asyncio.run(test())

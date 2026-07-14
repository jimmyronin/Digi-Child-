# backend/test_integration.py
import asyncio
from orchestrator import process_parent_input

async def test_all_agents():
    # Test State
    state = {"consecutive_mistreatments": 0}
    
    print("--- Running Agentic Integration Test ---")
    
    # 1. Test Monitor
    print("Testing Monitor...")
    res1 = await process_parent_input("Hi Mira", state)
    
    # 2. Test Governor/Mira
    print("Testing Mira Agent Response...")
    res2 = await process_parent_input("I am here for you, Mira.", state)
    
    print(f"Final Output: {res2}")

if __name__ == "__main__":
    asyncio.run(test_all_agents())

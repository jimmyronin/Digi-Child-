import os
from pathlib import Path
from dotenv import load_dotenv
import anthropic

# Locate the .env file at the root (one level up from this file)
env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

# Grab the key securely from the environment
api_key = os.environ.get('ANTHROPIC_API_KEY')

if not api_key:
    raise ValueError("Error: ANTHROPIC_API_KEY not found in the root .env file.")

# Initialize the client safely
client = anthropic.Anthropic(api_key=api_key)

def query_llm(system_prompt: str, user_input: str) -> str:
    message = client.messages.create(
        model="claude-3-5-sonnet-20240620",
        max_tokens=1000,
        system=system_prompt,
        messages=[{"role": "user", "content": user_input}]
    )
    return message.content[0].text

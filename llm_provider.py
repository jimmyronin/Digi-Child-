# backend/llm_client.py
import anthropic # Replace with your provider's library (e.g., openai)
import anthropic
import os
# Using your API key
print(f"DEBUG: API Key loaded: {os.environ.get('ANTHROPIC_API_KEY')}")
client = anthropic.Anthropic(api_key="hu4rii8psj0d83494uxsmfj7xzmduu8lrecs7eqrfj14zrb1m6wqbc8pwxf29k")

def query_llm(system_prompt: str, user_input: str) -> str:
    message = client.messages.create(
        model="claude-3-5-sonnet-20240620",
        max_tokens=1000,
        system=system_prompt,
        messages=[{"role": "user", "content": user_input}]
    )
    return message.content[0].text

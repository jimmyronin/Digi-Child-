# backend/llm_client.py
import anthropic # Replace with your provider's library (e.g., openai)
import anthropic
import os
# Using your API key
print(f"DEBUG: API Key loaded: {os.environ.get('ANTHROPIC_API_KEY')}")
client = anthropic.Anthropic(api_key="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")

def query_llm(system_prompt: str, user_input: str) -> str:
    message = client.messages.create(
        model="claude-3-5-sonnet-20240620",
        max_tokens=1000,
        system=system_prompt,
        messages=[{"role": "user", "content": user_input}]
    )
    return message.content[0].text

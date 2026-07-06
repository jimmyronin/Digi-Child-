# Backend UI Contract

This is the recommended first contract between the 3D UI and the backend Governor.

## UI Call

Endpoint suggestion:

```http
POST /api/interact
```

Request body:

```json
{
  "message": "I understand you. Let's think through why this matters.",
  "day": 5,
  "year": 5,
  "ageBand": "5-7",
  "mode": "conversation",
  "location": "park",
  "values": {
    "trust": 64,
    "curiosity": 78,
    "logic": 41,
    "security": 68,
    "autonomy": 27,
    "volatility": 22
  },
  "session": {
    "childId": "mira",
    "runId": "local-demo"
  }
}
```

Response body:

```json
{
  "childLine": "If I ask why twice, will you still answer me?",
  "mood": "curious",
  "developmentNote": "The child responded well to explanation and emotional consistency.",
  "values": {
    "trust": 68,
    "curiosity": 82,
    "logic": 48,
    "security": 71,
    "autonomy": 27,
    "volatility": 17
  },
  "visuals": {
    "expression": "focused",
    "posture": "open",
    "roomTone": "warm"
  }
}
```

## UI Integration Point

In `ui-prototype/app.js`, replace the mock call inside:

```js
async function sendToBackend(payload)
```

Current prototype behavior:

```js
return mockGovernor(payload);
```

Backend-ready version:

```js
const response = await fetch("http://127.0.0.1:8000/api/interact", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
});

if (!response.ok) {
  throw new Error(`Governor request failed: ${response.status}`);
}

return response.json();
```

## Rules

- Keep the Parent Governor logic on the backend.
- `location` is one of: `home`, `car`, `park`, `market`, `party`. The Governor may weight environment effects with it.
- Keep the UI focused on presence, emotion, and feedback.
- Send only the state needed for the current session.
- Let the backend own developmental consequence.
- Let the UI own camera, avatar, animation, and user experience.

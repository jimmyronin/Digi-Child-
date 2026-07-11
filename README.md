 frontend
# Digi-Child

Digi-Child is the UI and product package for the AI-native parenting simulator MVP.

The product idea is simple: the user is not just chatting with an AI. The user acts as the parent, and the child changes over time based on how the parent communicates, guides, neglects, contradicts, supports, or challenges it.

## Live Deployment

- Frontend: https://mitraker.github.io/Digi-Child-Live/
- Backend API: https://digichild-backend.onrender.com
- Source repo: https://github.com/MITRAKER/Digi-Child-Live
- Backend source is included in `backend/` and Render configuration is in `render.yaml`.

The backend is deployed on Render as `digichild-backend` from the `main` branch with auto-deploy enabled. It uses the Python runtime, `rootDir: backend`, installs `backend/requirements.txt`, and starts `uvicorn main:app`.

The live backend currently runs on Render's free plan without a persistent disk. A persistent `/data` disk requires billing on Render; after billing is enabled, attach a disk at `/data` and set `DIGICHILD_DB_PATH=/data/digichild.db` for durable SQLite storage.

The deployed frontend uses the live backend by default. You can still override the backend by opening:

```text
https://mitraker.github.io/Digi-Child-Live/?backend=https://YOUR-BACKEND.onrender.com
```

That backend URL is saved in browser local storage for later visits.

## Folder Structure

- `docs/` contains the PRD and project brief.
- `ui-prototype/` contains the first 3D browser prototype.
- `handoff/` contains backend wiring notes and next-step planning.

## Run The UI Prototype

Open PowerShell:

```powershell
cd D:\Pursuit\L2\Digi-Child\ui-prototype
.\run-ui.ps1
```

Then open:

```text
http://127.0.0.1:5178
```

The prototype currently uses Three.js from a CDN, so it needs internet access unless Three.js is later vendored locally.

## Current Prototype

The UI is built as a first-person 3D game:

- The user is the camera. You see the world through the parent's eyes.
- Five explorable places, each with its own scene, lighting, and mood:
  - **Home** — a house with separate rooms (living room, kitchen, bedroom, bathroom) you can walk between.
  - **Car Ride** — you sit in the driver's seat while the world drives past; Mira sits beside you.
  - **Park** — a playground with animated swings, merry-go-round, seesaw, and slide.
  - **Supermarket** — colorful aisles, checkout lanes, and signs.
  - **Family Party** — a candlelit dinner with seated family members and decorations.
- The child (Mira) is a real VRoid Studio character (`.vrm`), loaded with `@pixiv/three-vrm`. Fifteen models in `ui-prototype/assets/mira/` cover her whole life: `mira-01..05` (child), `mira-06..10` (teenager), `mira-11..15` (adult). The sim age picks which model is loaded, so she visibly grows up as the days pass. She blinks, her expression follows her emotional state (happy / sad / angry via VRM expressions), she turns her body toward the parent and tracks them with her head and eyes, and she sits properly in the car and at the party table. She is small as a child, so the parent looks down at her and she looks up at the camera.
- Rendering uses image-based environment lighting, SSAO, bloom post-processing (three.js EffectComposer), ACES tone mapping, and floating dust-mote particles for a warm, cinematic look. Three.js addons load via an import map in `index.html`.
- The locations are furnished with real professionally-modeled 3D assets from [Kenney](https://kenney.nl) (CC0 license, free for any use): the Furniture Kit (house interiors), Nature Kit (park), City Kit Suburban + Car Kit (car ride), Food Kit (supermarket shelves and the feast), and Holiday Kit (party decorations). The `.glb` models live in `ui-prototype/assets/` and load at runtime via `GLTFLoader`; newer kits keep their colors in `Textures/colormap.png` next to the models, so that folder must ship alongside the `.glb` files.
- She is present in every scene, turns to face you, tracks you with her head, and grows in size as the age band advances (Age 5-7 → 10-12 → 14-16).
- Arriving at a place triggers an age-appropriate reaction line from Mira.
- The parent speaks through the bottom input.
- The visible child response and hidden state metrics update after interaction.
- The hidden Parent Governor is represented as a mock adapter for now. Each interaction now also sends the current `location`, and where you parent nudges the scores slightly (e.g. park boosts curiosity).
- **Mira reacts emotionally to what you say and do.** After each message, the game reads your words and drives a live reaction on the VRoid model:
  - Kind/loving words ("I'm proud of you", "good girl", "let's play") → she lights up, bounces, and giggles.
  - Hurtful words ("you're stupid", "I hate you", "bad kid") → she cries: sad face, hands to her face, a hunched sob, and a wailing sound, all while looking up at you.
  - Physical words ("hit", "slap", "spank") → she screams — a wide-open-mouth shocked flinch and a scream, then settles into crying.
  - When she's feeling secure and content and has room (home/park), she plays on her own: wandering back and forth, little hops, and occasional giggles.
  - Reaction sounds are synthesized with the Web Audio API, so they always work with no external files. The party crowd chatter is a streamed royalty-free loop.
- **Car seat safety:** as a toddler she rides in a child safety seat with a visible 5-point harness (shoulder straps → central buckle); older Mira uses a standard diagonal seat belt.

### Controls

| Input | Action |
+| --- | --- |
| Click the 3D world | Capture the mouse (first-person look) |
| Mouse | Look around |
| WASD / arrow keys | Walk (walkable scenes) |
| Shift | Walk faster |
| 1–5 or the top buttons | Travel between places |
| Enter | Release the mouse and focus the chat input |
| Esc | Release the mouse |

The backend integration point is in:

```text
ui-prototype/app.js
```

Look for:

```js
async function sendToBackend(payload)
```

Replace the mock Governor call inside that function with your friend's backend endpoint.
=======
# Digi-Child Sim

An AI-native behavioral simulation where users mentor a digital entity from birth to pre-adulthood. 

## Project Overview
Digi-Child Sim is an interactive, local-first simulation. The system tracks developmental states including age, trust, and personality traits, which evolve based on the "parent's" (user's) input.

## Architecture
- **/parent**: Contains the simulation loop and governance logic.
- **/child_agent**: Contains the persona-based brain that responds to the user.
- **/shared_data**: Contains the state of the simulation (Note: This directory is ignored by Git to maintain local sovereignty).

## Setup
1. Clone the repository: `git clone https://github.com/jimmyronin/Digi-Child-.git`
2. Initialize your local state: Create a `shared_data/state.json` file with the following structure:
```json
{
  "child_age": 0,
  "trust_level": 100,
  "temperament": "neutral",
  "habits": [],
  "consecutive_mistreatments": 0,
  "history": []
}# Digi-Child-
 main

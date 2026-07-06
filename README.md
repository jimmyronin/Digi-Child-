# Digi-Child

Digi-Child is the UI and product package for the AI-native parenting simulator MVP.

The product idea is simple: the user is not just chatting with an AI. The user acts as the parent, and the child changes over time based on how the parent communicates, guides, neglects, contradicts, supports, or challenges it.

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
- The child (Mira) is a toddler-styled character inspired by cozy-game character creators: a sculpted silver bob with chunky bangs, orange hair clips and low pigtails, a hand-painted face on a canvas texture (glossy gradient blue eyes with catchlights and lashes, freckles, blush), and a sage-green cat-print sweater. She blinks every few seconds and her expression follows her emotional state. She is small, so the parent looks down at her and she looks up at the camera.
- Rendering uses image-based environment lighting, SSAO, bloom post-processing (three.js EffectComposer), ACES tone mapping, and floating dust-mote particles for a warm, cinematic look. Three.js addons load via an import map in `index.html`.
- The locations are furnished with real professionally-modeled 3D assets from [Kenney](https://kenney.nl) (CC0 license, free for any use): the Furniture Kit (house interiors), Nature Kit (park), City Kit Suburban + Car Kit (car ride), Food Kit (supermarket shelves and the feast), and Holiday Kit (party decorations). The `.glb` models live in `ui-prototype/assets/` and load at runtime via `GLTFLoader`; newer kits keep their colors in `Textures/colormap.png` next to the models, so that folder must ship alongside the `.glb` files.
- She is present in every scene, turns to face you, tracks you with her head, and grows in size as the age band advances (Age 5-7 → 10-12 → 14-16).
- Arriving at a place triggers an age-appropriate reaction line from Mira.
- The parent speaks through the bottom input.
- The visible child response and hidden state metrics update after interaction.
- The hidden Parent Governor is represented as a mock adapter for now. Each interaction now also sends the current `location`, and where you parent nudges the scores slightly (e.g. park boosts curiosity).

### Controls

| Input | Action |
| --- | --- |
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

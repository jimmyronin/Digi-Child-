from child_agent.logic import get_thinking_response
from fastapi import FastAPI, WebSocket
from typing import List

app = FastAPI()

# Store active UI connections
connected_uis: List[WebSocket] = []

@app.websocket("/ws/control")
async def control_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_uis.append(websocket)
    try:
        while True:
            # Keep the connection open and listen for heartbeat
            await websocket.receive_text()
    except:
        connected_uis.remove(websocket)

async def broadcast_pause_signal(reason: str):
    """Broadcasts a pause command to all connected UI clients."""
    payload = {"event": "SESSION_PAUSED", "reason": reason}
    for connection in connected_uis:
        await connection.send_json(payload)

"""WebSocket endpoint for real-time sync (W3)."""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.realtime import manager, rooms_for_user, _user_from_token

router = APIRouter(prefix="/api")


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    token = websocket.query_params.get("token")
    user = await _user_from_token(token)
    if not user:
        await websocket.close(code=1008)
        return
    rooms = await rooms_for_user(user["id"])
    await manager.connect(websocket, rooms)
    try:
        while True:
            # We don't need client messages; this keeps the socket open.
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, rooms)
    except Exception:
        manager.disconnect(websocket, rooms)

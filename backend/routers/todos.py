"""To-Do lists — a shared Team Hub list plus lists attached to competitions & events.

Household-scoped (visible to everyone sharing the account). The Team Hub list
lives behind the gated Team tab; competition/event lists are personal.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.models import Todo, TodoCreate, TodoUpdate, utcnow_iso
from core.security import get_current_user
from core.helpers import _team_hub_scope_user_ids as _household_user_ids

router = APIRouter(prefix="/api")


@router.get("/todos")
async def list_todos(scope: str = "team", ref_id: Optional[str] = None, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    q = {"user_id": {"$in": member_ids}, "scope": scope}
    q["ref_id"] = ref_id  # None matches the Team Hub list; a value matches that comp/event
    docs = await db.todos.find(q, {"_id": 0}).to_list(1000)
    docs.sort(key=lambda t: (t.get("done", False), t.get("order", 0), t.get("created_at", "")))
    return docs


@router.post("/todos", response_model=Todo)
async def create_todo(payload: TodoCreate, current_user=Depends(get_current_user)):
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Add some text.")
    todo = Todo(user_id=current_user["id"], text=text, scope=payload.scope, ref_id=payload.ref_id,
                order=int(utcnow_iso()[11:19].replace(":", "")))
    await db.todos.insert_one(todo.model_dump())
    return todo


@router.patch("/todos/{todo_id}", response_model=Todo)
async def update_todo(todo_id: str, payload: TodoUpdate, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    doc = await db.todos.find_one({"id": todo_id, "user_id": {"$in": member_ids}}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="To-do not found")
    updates = payload.model_dump(exclude_unset=True)
    if "text" in updates and updates["text"] is not None:
        updates["text"] = updates["text"].strip()
    if updates:
        await db.todos.update_one({"id": todo_id}, {"$set": updates})
        doc.update(updates)
    return Todo(**doc)


@router.delete("/todos/{todo_id}")
async def delete_todo(todo_id: str, current_user=Depends(get_current_user)):
    member_ids = await _household_user_ids(current_user["id"])
    res = await db.todos.delete_one({"id": todo_id, "user_id": {"$in": member_ids}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="To-do not found")
    return {"deleted": True}

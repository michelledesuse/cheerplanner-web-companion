"""Emergent Managed Object Storage — thin backend client.

The Expo app never talks to storage directly (the key is server-only). Every
upload/download flows through our own /api routes which call these helpers.
"""
import os

import requests

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "cheerplanner"

_storage_key = None


def init_storage():
    """Call once at startup. Idempotent — returns a reusable storage_key."""
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def _reset():
    global _storage_key
    _storage_key = None


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    url = f"{STORAGE_URL}/objects/{path}"
    resp = requests.put(url, headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=180)
    if resp.status_code == 503:  # stale key — reset + retry once
        _reset()
        key = init_storage()
        resp = requests.put(url, headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=180)
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    key = init_storage()
    url = f"{STORAGE_URL}/objects/{path}"
    resp = requests.get(url, headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 503:
        _reset()
        key = init_storage()
        resp = requests.get(url, headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")

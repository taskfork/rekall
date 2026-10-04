"""
Authentication, OIDC authorization flow, and session management for Rekall.
"""

import json
import re
import secrets
import sqlite3
import threading
import time
import urllib.parse
import urllib.request
import uuid

from config import (
    AUTH_COOKIE_NAMES,
    AUTH_DB,
    OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET,
    OIDC_ISSUER_URL,
    OIDC_REDIRECT_URL,
)

user_profile_cache = {}
session_cache = {}
session_lock = threading.Lock()


def get_session_tokens(headers):
    """
    Extracts all candidate session tokens from Cookie headers.
    A browser can hold both a host-only and a Domain=example.com cookie with the
    same name, and sends both. Return every candidate, not just the first.
    """
    cookie_header = headers.get("Cookie", "")
    tokens = []
    for item in cookie_header.split(";"):
        parts = item.strip().split("=", 1)
        if len(parts) == 2 and parts[0].strip() in AUTH_COOKIE_NAMES and parts[1].strip():
            tokens.append(parts[1].strip())
    return tokens


def authenticate(headers):
    """Authenticates the incoming request, returning (user_id, token) or (None, None)."""
    for token in get_session_tokens(headers):
        user_id = validate_session(token)
        if user_id:
            return user_id, token
    return None, None


def validate_session(token):
    """Validates session token against the auth SQLite database."""
    if not token:
        return None

    try:
        uri = f"file:{AUTH_DB}?mode=ro"
        conn = sqlite3.connect(uri, uri=True, timeout=2.0)
        row = conn.execute(
            "SELECT user_id, expires_at FROM sessions WHERE id = ?",
            (token,)
        ).fetchone()
        conn.close()
        if row and row[1] and row[1] > time.time():
            return row[0]
    except Exception as e:
        print(f"Error querying session: {e}")

    return None


def get_user_info(user_id):
    """Returns user profile dictionary including username and display name."""
    if not user_id:
        return None
    try:
        uri = f"file:{AUTH_DB}?mode=ro"
        conn = sqlite3.connect(uri, uri=True, timeout=2.0)
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT id, username, created_at FROM users WHERE id = ?", (user_id,)).fetchone()
        conn.close()
        if row:
            cached = user_profile_cache.get(user_id, {})
            disp = cached.get("name")
            if not disp:
                uname = row["username"]
                if re.match(r'^[0-9a-fA-F-]{36}$', uname):
                    disp = "User"
                else:
                    disp = uname
            return {
                "id": row["id"],
                "username": row["username"],
                "display_name": disp,
                "email": cached.get("email", "")
            }
    except Exception as e:
        print(f"Error querying user info: {e}")
    return None


def exchange_oidc_code(code):
    """Exchanges an OIDC authorization code for tokens via token endpoint."""
    token_endpoint = f"{OIDC_ISSUER_URL}/api/oidc/token"
    post_data = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": OIDC_REDIRECT_URL,
        "client_id": OIDC_CLIENT_ID,
        "client_secret": OIDC_CLIENT_SECRET,
    }).encode("utf-8")

    req = urllib.request.Request(
        token_endpoint,
        data=post_data,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        }
    )
    with urllib.request.urlopen(req, timeout=10.0) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_oidc_userinfo(access_token):
    """Fetches user claims from OIDC userinfo endpoint."""
    userinfo_endpoint = f"{OIDC_ISSUER_URL}/api/oidc/userinfo"
    req = urllib.request.Request(
        userinfo_endpoint,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json"
        }
    )
    with urllib.request.urlopen(req, timeout=10.0) as resp:
        return json.loads(resp.read().decode("utf-8"))


def find_or_create_user_and_session(userinfo):
    """Maps OIDC userinfo to local user record and issues a new session ID."""
    sub = userinfo.get("sub", "")
    preferred_username = userinfo.get("preferred_username", "")
    name = userinfo.get("name") or preferred_username or "User"
    email = userinfo.get("email", "")

    if not sub:
        raise ValueError("Missing 'sub' claim in OIDC userinfo")

    conn = sqlite3.connect(AUTH_DB, timeout=5.0)
    try:
        # Match sub or preferred_username in users
        row = conn.execute("SELECT id FROM users WHERE username = ?", (sub,)).fetchone()
        if not row and preferred_username:
            row = conn.execute("SELECT id FROM users WHERE username = ?", (preferred_username,)).fetchone()

        if row:
            user_id = row[0]
        else:
            user_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
                (user_id, sub, "*oidc*", int(time.time()))
            )

        session_id = secrets.token_hex(32)
        expires_at = int(time.time()) + (30 * 24 * 3600)  # 30 days
        conn.execute(
            "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (session_id, user_id, int(time.time()), expires_at)
        )
        conn.commit()

        user_profile_cache[user_id] = {
            "name": name,
            "email": email,
            "username": preferred_username or sub
        }
        return session_id, user_id
    finally:
        conn.close()


def delete_session(session_id):
    """Removes a session from AUTH_DB upon logout."""
    if not session_id:
        return
    try:
        conn = sqlite3.connect(AUTH_DB, timeout=5.0)
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error deleting session: {e}")

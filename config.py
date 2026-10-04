"""
Configuration, environment settings, and database helpers for Rekall.
"""

import os
import sqlite3

import ingest

DATA_DIR = os.environ.get("DATA_DIR", "/data")
CACHE_DIR = os.environ.get("CACHE_DIR", "/cache")
try:
    os.makedirs(CACHE_DIR, exist_ok=True)
except (PermissionError, OSError):
    pass

AUTH_DB = os.environ.get("AUTH_DB", os.environ.get("SBV_AUTH_DB", os.path.join(DATA_DIR, "sbv.db")))
SBV_AUTH_DB = AUTH_DB  # Backward compatibility alias

AUTH_COOKIE_NAMES = ["session_id", "session_token"]
CLEAR_HOST_COOKIE = "session_id=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"

LOGIN_URL = os.environ.get("LOGIN_URL", os.environ.get("SBV_LOGIN_URL", "/api/auth/oidc/login"))
SBV_LOGIN_URL = LOGIN_URL
PORT = int(os.environ.get("PORT", "3089"))
STATIC_DIR = os.environ.get("STATIC_DIR", "/app/static")
REQUIRE_AUTH = os.environ.get("REQUIRE_AUTH", "1") == "1"
COOKIE_DOMAIN = os.environ.get("COOKIE_DOMAIN", "")

OIDC_ISSUER_URL = os.environ.get("OIDC_ISSUER_URL", "https://auth.example.com").rstrip("/")
OIDC_CLIENT_ID = os.environ.get("OIDC_CLIENT_ID", "rekall")
OIDC_CLIENT_SECRET = os.environ.get("OIDC_CLIENT_SECRET", "")
OIDC_REDIRECT_URL = os.environ.get("OIDC_REDIRECT_URL", "http://localhost:3089/api/auth/oidc/callback")


def init_auth_db():
    """Ensure the users and sessions tables exist in AUTH_DB."""
    db_dir = os.path.dirname(AUTH_DB)
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(AUTH_DB, timeout=5.0)
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                display_name TEXT,
                preferred_username TEXT,
                email TEXT
            );
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );
        """)
        # Auto-migrate existing users table columns if missing
        cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
        if "display_name" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN display_name TEXT;")
        if "preferred_username" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN preferred_username TEXT;")
        if "email" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN email TEXT;")
        conn.commit()
    finally:
        conn.close()


def get_user_db_path(user_id, create_if_missing=False):
    """
    Locates the SQLite database path for a user.
    Checks rekall_<user_id>.db first, then legacy sbv_<user_id>.db.
    """
    if user_id:
        target_rekall = os.path.join(DATA_DIR, f"rekall_{user_id}.db")
        target_sbv = os.path.join(DATA_DIR, f"sbv_{user_id}.db")
        if os.path.isfile(target_rekall):
            return target_rekall
        if os.path.isfile(target_sbv):
            return target_sbv
        if create_if_missing:
            # Prefer sbv_ prefix if legacy databases exist, otherwise rekall_
            use_legacy = os.path.isdir(DATA_DIR) and any(f.startswith("sbv_") for f in os.listdir(DATA_DIR))
            target = target_sbv if use_legacy else target_rekall
            ingest.init_user_db(target)
            return target
        return None

    # Local unauthenticated dev mode fallback
    if not REQUIRE_AUTH and os.path.isdir(DATA_DIR):
        candidates = [
            os.path.join(DATA_DIR, f)
            for f in os.listdir(DATA_DIR)
            if (f.startswith("rekall_") or f.startswith("sbv_")) and f.endswith(".db") and not f.endswith(("-wal", "-shm"))
        ]
        if candidates:
            candidates.sort(key=lambda p: os.path.getsize(p), reverse=True)
            return candidates[0]

    return None


def get_db(user_id):
    """Returns a read-only sqlite3 connection with Row factory."""
    db_path = get_user_db_path(user_id)
    if not db_path or not os.path.isfile(db_path):
        return None
    uri = f"file:{db_path}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, check_same_thread=False, timeout=5.0)
    conn.row_factory = sqlite3.Row
    return conn

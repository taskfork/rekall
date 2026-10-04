#!/usr/bin/env python3
"""
HTTP Server and API router for Rekall.
"""

import json
import os
import re
import secrets
import sqlite3
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import analytics
import auth
from config import (
    AUTH_DB,
    CACHE_DIR,
    CLEAR_HOST_COOKIE,
    COOKIE_DOMAIN,
    LOGIN_URL,
    OIDC_CLIENT_ID,
    OIDC_ISSUER_URL,
    OIDC_REDIRECT_URL,
    PORT,
    REQUIRE_AUTH,
    STATIC_DIR,
    get_db,
    get_user_db_path,
    init_auth_db,
)
import contacts
import ingest
import media

# Security & Ingress Constants
_env_origins = os.environ.get("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = tuple(x.strip() for x in _env_origins.split(",") if x.strip())
MAX_UPLOAD_SIZE = int(os.environ.get("MAX_UPLOAD_SIZE", str(25 * 1024 * 1024 * 1024)))  # 25 GB limit

# In-memory progress tracking for background imports: user_id -> dict
upload_progress = {}
upload_progress_lock = threading.Lock()


def update_upload_progress(user_id, info):
    with upload_progress_lock:
        upload_progress[user_id] = info


def get_upload_progress(user_id):
    with upload_progress_lock:
        return upload_progress.get(user_id, {"status": "no_upload"})


class SMSHandler(BaseHTTPRequestHandler):

    def send_cors_and_json(self, data, status=200, extra_headers=None):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        for k, v in (extra_headers or []):
            self.send_header(k, v)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
        self.end_headers()
        self.wfile.write(body)

    def serve_file(self, filename, content_type):
        real_static = os.path.realpath(STATIC_DIR)
        target_path = os.path.realpath(os.path.join(real_static, filename))
        try:
            if os.path.commonpath([real_static, target_path]) != real_static or not os.path.isfile(target_path):
                self.send_response(404)
                self.end_headers()
                return
        except ValueError:
            self.send_response(404)
            self.end_headers()
            return
        with open(target_path, "rb") as f:
            content = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def do_OPTIONS(self):
        self.send_response(204)
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Cookie, X-Filename")
        self.end_headers()

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/")
        params = urllib.parse.parse_qs(parsed.query)

        # Unauthenticated public endpoints
        if path == "/health":
            now = time.time()
            with auth.session_lock:
                active_s = sum(1 for _, exp in auth.session_cache.values() if exp > now)
            self.send_cors_and_json({
                "status": "ok",
                "active_sessions": active_s,
                "users_cached": len(contacts.user_caches)
            })
            return

        # Public static assets (CSS, JS, manifest, icons)
        if path.startswith("/css/") or path.startswith("/js/") or path == "/manifest.json" or path.endswith((".css", ".js", ".json", ".png", ".svg", ".ico")):
            rel_path = path.lstrip("/")
            file_path = os.path.join(STATIC_DIR, rel_path)
            if os.path.isfile(file_path):
                content_type = "text/plain"
                if path.endswith(".css"):
                    content_type = "text/css; charset=utf-8"
                elif path.endswith(".js"):
                    content_type = "application/javascript; charset=utf-8"
                elif path.endswith(".json"):
                    content_type = "application/json; charset=utf-8"
                elif path.endswith(".png"):
                    content_type = "image/png"
                elif path.endswith(".svg"):
                    content_type = "image/svg+xml"
                elif path.endswith(".ico"):
                    content_type = "image/x-icon"
                self.serve_file(rel_path, content_type)
                return

        # OIDC Authentication Endpoints
        if path in ("/api/auth/oidc/login", "/auth/login"):
            state = secrets.token_urlsafe(32)
            nonce = secrets.token_urlsafe(32)
            auth_params = {
                "client_id": OIDC_CLIENT_ID,
                "redirect_uri": OIDC_REDIRECT_URL,
                "response_type": "code",
                "scope": "openid profile email",
                "state": state,
                "nonce": nonce,
            }
            auth_url = f"{OIDC_ISSUER_URL}/api/oidc/authorization?{urllib.parse.urlencode(auth_params)}"
            flow_cookie = f"rekall_oidc_flow={state}:{nonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300"
            self.send_response(302)
            self.send_header("Location", auth_url)
            self.send_header("Set-Cookie", flow_cookie)
            self.send_header("Cache-Control", "no-cache, no-store")
            self.end_headers()
            return

        if path in ("/api/auth/oidc/callback", "/auth/callback"):
            code = params.get("code", [None])[0]
            state = params.get("state", [None])[0]

            # Validate state from flow cookie
            flow_cookie = ""
            cookie_header = self.headers.get("Cookie", "")
            for item in cookie_header.split(";"):
                p = item.strip().split("=", 1)
                if len(p) == 2 and p[0].strip() == "rekall_oidc_flow":
                    flow_cookie = p[1].strip()
                    break

            expected_state = flow_cookie.split(":", 1)[0] if ":" in flow_cookie else flow_cookie
            if not code or not state or state != expected_state:
                self.send_cors_and_json({"error": "Invalid OIDC state or authorization code"}, status=400)
                return

            try:
                token_resp = auth.exchange_oidc_code(code)
                access_token = token_resp.get("access_token")
                if not access_token:
                    self.send_cors_and_json({"error": "Token exchange failed", "details": token_resp}, status=500)
                    return

                userinfo = auth.fetch_oidc_userinfo(access_token)
                session_id, user_id = auth.find_or_create_user_and_session(userinfo)

                domain_attr = f"; Domain={COOKIE_DOMAIN}" if COOKIE_DOMAIN else ""
                self.send_response(302)
                self.send_header("Location", "/")
                self.send_header("Set-Cookie", f"session_id={session_id}; Path=/{domain_attr}; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax")
                self.send_header("Set-Cookie", f"session_token={session_id}; Path=/{domain_attr}; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax")
                self.send_header("Set-Cookie", "rekall_oidc_flow=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax")
                self.send_header("Cache-Control", "no-cache, no-store")
                self.end_headers()
                return
            except Exception as e:
                print(f"OIDC callback error: {e}")
                self.send_cors_and_json({"error": "OIDC callback processing failed", "message": str(e)}, status=500)
                return

        if path in ("/api/auth/logout", "/auth/logout", "/logout"):
            for t in auth.get_session_tokens(self.headers):
                auth.delete_session(t)

            domain_attr = f"; Domain={COOKIE_DOMAIN}" if COOKIE_DOMAIN else ""
            self.send_response(302)
            self.send_header("Location", f"{OIDC_ISSUER_URL}/logout" if OIDC_ISSUER_URL else "/")
            self.send_header("Set-Cookie", f"session_id=; Path=/{domain_attr}; Max-Age=0; HttpOnly; Secure; SameSite=Lax")
            self.send_header("Set-Cookie", f"session_token=; Path=/{domain_attr}; Max-Age=0; HttpOnly; Secure; SameSite=Lax")
            self.send_header("Set-Cookie", "session_id=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax")
            self.send_header("Set-Cookie", "session_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax")
            self.send_header("Cache-Control", "no-cache, no-store")
            self.end_headers()
            return

        if path in ("/api/auth/me", "/auth/me"):
            user_id, session_token = auth.authenticate(self.headers)
            if not user_id:
                self.send_cors_and_json({"authenticated": False}, status=401)
                return
            info = auth.get_user_info(user_id) or {"id": user_id, "username": user_id, "display_name": "User"}
            self.send_cors_and_json({
                "authenticated": True,
                "user_id": user_id,
                "username": info.get("username", user_id),
                "display_name": info.get("display_name", "User"),
                "email": info.get("email", "")
            })
            return

        # Authenticate session
        user_id = None
        session_token = None
        if REQUIRE_AUTH:
            user_id, session_token = auth.authenticate(self.headers)
            if not user_id:
                if path in ("", "/index.html"):
                    self.send_response(302)
                    self.send_header("Location", LOGIN_URL)
                    self.send_header("Cache-Control", "no-cache, no-store")
                    self.send_header("Set-Cookie", CLEAR_HOST_COOKIE)
                    self.end_headers()
                    return
                self.send_cors_and_json({
                    "error": "Unauthorized",
                    "login_url": LOGIN_URL
                }, status=401, extra_headers=[("Set-Cookie", CLEAR_HOST_COOKIE)])
                return

        # Progress tracking for imports
        if path in ("/api/progress", "/progress"):
            prog = get_upload_progress(user_id)
            self.send_cors_and_json(prog)
            return

        # Serve frontend for authenticated users
        if path == "" or path == "/index.html":
            self.serve_file("index.html", "text/html; charset=utf-8")
            return

        # Normalize /api/ prefix
        if path.startswith("/api"):
            path = path[4:]

        if path == "/analytics":
            data = analytics.get_user_analytics(user_id)
            self.send_cors_and_json(data or {})
            return

        if path == "/contacts":
            contact_list, is_indexing = contacts.get_or_index_contacts(user_id)
            q = params.get("q", [""])[0].strip().lower()
            tab = params.get("tab", ["all"])[0].strip().lower()
            try:
                limit = int(params.get("limit", [50])[0])
            except (ValueError, IndexError):
                limit = 50
            try:
                offset = int(params.get("offset", [0])[0])
            except (ValueError, IndexError):
                offset = 0

            known_count = sum(1 for c in contact_list if not c.get("is_unknown"))
            unknown_count = sum(1 for c in contact_list if c.get("is_unknown"))

            if tab == "known":
                pool = [c for c in contact_list if not c.get("is_unknown")]
            elif tab == "unknown":
                pool = [c for c in contact_list if c.get("is_unknown")]
            else:
                pool = contact_list

            if not q:
                matched = pool
            else:
                matched = [
                    c for c in pool
                    if q in c["name"].lower() or q in c["address"].lower()
                ]

            if limit <= 0:
                paged = matched
            else:
                paged = matched[offset:offset + limit]

            self.send_cors_and_json({
                "contacts": paged,
                "total": len(matched),
                "known_count": known_count,
                "unknown_count": unknown_count,
                "offset": offset,
                "has_more": (offset + len(paged)) < len(matched)
            })
            return

        conn = get_db(user_id)
        if not conn:
            self.send_cors_and_json({"error": "No database found for this account"}, 404)
            return
        cur = conn.cursor()

        try:
            if path == "/messages":
                address = params.get("address", [""])[0]
                if not address:
                    self.send_cors_and_json({"error": "address is required"}, 400)
                    return

                limit = min(int(params.get("limit", ["50"])[0]), 100)
                before = params.get("before", [""])[0]
                after = params.get("after", [""])[0]

                if before:
                    query = """
                        SELECT id, address, contact_name, type, date, body, media_type
                        FROM messages
                        WHERE address = ? AND date < ? AND record_type IN (1, 2)
                        ORDER BY date DESC LIMIT ?
                    """
                    rows = cur.execute(query, (address, int(before), limit)).fetchall()
                    messages = [dict(r) for r in reversed(rows)]
                elif after:
                    query = """
                        SELECT id, address, contact_name, type, date, body, media_type
                        FROM messages
                        WHERE address = ? AND date > ? AND record_type IN (1, 2)
                        ORDER BY date ASC LIMIT ?
                    """
                    rows = cur.execute(query, (address, int(after), limit)).fetchall()
                    messages = [dict(r) for r in rows]
                else:
                    query = """
                        SELECT id, address, contact_name, type, date, body, media_type
                        FROM messages
                        WHERE address = ? AND record_type IN (1, 2)
                        ORDER BY date DESC LIMIT ?
                    """
                    rows = cur.execute(query, (address, limit)).fetchall()
                    messages = [dict(r) for r in reversed(rows)]

                self.send_cors_and_json({"messages": messages})
                return

            if path == "/media":
                msg_id = params.get("id", [""])[0]
                if not msg_id or not msg_id.isdigit():
                    self.send_cors_and_json({"error": "Valid id is required"}, 400)
                    return

                is_thumb = params.get("thumb", ["0"])[0] == "1"

                # Fast disk cache check before touching SQLite
                if is_thumb and user_id:
                    cache_file = os.path.join(CACHE_DIR, f"{user_id}_{msg_id}.webp")
                    if os.path.isfile(cache_file) and os.path.getsize(cache_file) > 0:
                        try:
                            with open(cache_file, "rb") as f:
                                content = f.read()
                            self.send_response(200)
                            self.send_header("Content-Type", "image/webp")
                            self.send_header("Content-Length", str(len(content)))
                            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
                            origin = self.headers.get("Origin", "")
                            if origin in ALLOWED_ORIGINS:
                                self.send_header("Access-Control-Allow-Origin", origin)
                                self.send_header("Access-Control-Allow-Credentials", "true")
                            self.send_header("X-Content-Type-Options", "nosniff")
                            self.end_headers()
                            if self.command != "HEAD":
                                self.wfile.write(content)
                            return
                        except Exception:
                            pass

                row = cur.execute(
                    "SELECT media_type, media_data FROM messages WHERE id = ? AND media_data IS NOT NULL",
                    (int(msg_id),)
                ).fetchone()

                if not row or not row["media_data"]:
                    self.send_cors_and_json({"error": "Media not found"}, 404)
                    return

                media_type = row["media_type"] or "application/octet-stream"
                media_data = row["media_data"]

                if is_thumb:
                    content, content_type = media.get_or_create_thumbnail(user_id or "default", msg_id, media_type, media_data)
                else:
                    content, content_type = media_data, media_type

                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(content)))
                self.send_header("Cache-Control", "public, max-age=31536000, immutable")
                self.send_header("X-Content-Type-Options", "nosniff")
                origin = self.headers.get("Origin", "")
                if origin in ALLOWED_ORIGINS:
                    self.send_header("Access-Control-Allow-Origin", origin)
                    self.send_header("Access-Control-Allow-Credentials", "true")
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(content)
                return

            if path == "/conversation-media":
                address = params.get("address", [""])[0]
                if not address:
                    self.send_cors_and_json({"error": "address is required"}, 400)
                    return

                try:
                    limit = int(params.get("limit", [48])[0])
                except (ValueError, IndexError):
                    limit = 48
                try:
                    offset = int(params.get("offset", [0])[0])
                except (ValueError, IndexError):
                    offset = 0

                total_row = cur.execute(
                    "SELECT count(*) FROM messages WHERE address = ? AND media_data IS NOT NULL",
                    (address,)
                ).fetchone()
                total = total_row[0] if total_row else 0

                if limit <= 0:
                    query = """
                        SELECT id, date, type, media_type, length(media_data) as size, body
                        FROM messages
                        WHERE address = ? AND media_data IS NOT NULL
                        ORDER BY date DESC
                    """
                    rows = cur.execute(query, (address,)).fetchall()
                else:
                    query = """
                        SELECT id, date, type, media_type, length(media_data) as size, body
                        FROM messages
                        WHERE address = ? AND media_data IS NOT NULL
                        ORDER BY date DESC LIMIT ? OFFSET ?
                    """
                    rows = cur.execute(query, (address, limit, offset)).fetchall()

                media_list = [dict(r) for r in rows]
                self.send_cors_and_json({
                    "media": media_list,
                    "total": total,
                    "offset": offset,
                    "limit": limit,
                    "has_more": (offset + len(media_list)) < total
                })
                return

            if path == "/search":
                q = params.get("q", [""])[0].strip()
                address = params.get("address", [""])[0].strip()
                if not q:
                    self.send_cors_and_json({"results": []})
                    return

                try:
                    limit = int(params.get("limit", [50])[0])
                except (ValueError, IndexError):
                    limit = 50
                try:
                    offset = int(params.get("offset", [0])[0])
                except (ValueError, IndexError):
                    offset = 0

                results = []
                has_fts = cur.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='messages_fts'"
                ).fetchone()

                if has_fts:
                    clean = re.sub(r'["\'*^:()\-]', ' ', q).strip()
                    words = clean.split()
                    if words:
                        fts_term = ' '.join(f'"{w}"' for w in words[:-1]) + f' "{words[-1]}"*' if len(words) > 1 else f'"{words[0]}"*'
                        try:
                            if address:
                                query = """
                                    SELECT m.id, m.address, COALESCE(NULLIF(m.contact_name, ''), m.address) as contact_name,
                                           m.type, m.date,
                                           snippet(messages_fts, 2, '<mark class="bg-warning text-warning-content rounded px-0.5">', '</mark>', '...', 12) as snippet,
                                           bm25(messages_fts) as score
                                    FROM messages_fts f
                                    JOIN messages m ON f.rowid = m.id
                                    WHERE messages_fts MATCH ? AND m.address = ?
                                    ORDER BY bm25(messages_fts) ASC, m.date DESC LIMIT ? OFFSET ?
                                """
                                rows = cur.execute(query, (fts_term, address, limit, offset)).fetchall()
                            else:
                                query = """
                                    SELECT m.id, m.address, COALESCE(NULLIF(m.contact_name, ''), m.address) as contact_name,
                                           m.type, m.date,
                                           snippet(messages_fts, 2, '<mark class="bg-warning text-warning-content rounded px-0.5">', '</mark>', '...', 12) as snippet,
                                           bm25(messages_fts) as score
                                    FROM messages_fts f
                                    JOIN messages m ON f.rowid = m.id
                                    WHERE messages_fts MATCH ?
                                    ORDER BY bm25(messages_fts) ASC, m.date DESC LIMIT ? OFFSET ?
                                """
                                rows = cur.execute(query, (fts_term, limit, offset)).fetchall()
                            for r in rows:
                                d = dict(r)
                                d["score"] = round(abs(d.get("score") or 1.0), 2)
                                results.append(d)
                        except Exception as e:
                            print(f"FTS search error, falling back to LIKE: {e}")
                            results = []

                if not results:
                    like_term = f"%{q}%"
                    if address:
                        query = """
                            SELECT id, address, COALESCE(NULLIF(contact_name, ''), address) as contact_name, type, date, body as snippet
                            FROM messages
                            WHERE address = ? AND body LIKE ? AND record_type IN (1, 2)
                            ORDER BY date DESC LIMIT ? OFFSET ?
                        """
                        rows = cur.execute(query, (address, like_term, limit, offset)).fetchall()
                    else:
                        query = """
                            SELECT id, address, COALESCE(NULLIF(contact_name, ''), address) as contact_name, type, date, body as snippet
                            FROM messages
                            WHERE body LIKE ? AND record_type IN (1, 2)
                            ORDER BY date DESC LIMIT ? OFFSET ?
                        """
                        rows = cur.execute(query, (like_term, limit, offset)).fetchall()
                    results = [dict(r) for r in rows]

                self.send_cors_and_json({
                    "results": results,
                    "offset": offset,
                    "limit": limit,
                    "has_more": len(results) == limit
                })
                return

            if path == "/context":
                msg_id = params.get("id", [""])[0]
                if not msg_id:
                    self.send_cors_and_json({"error": "id is required"}, 400)
                    return

                target = cur.execute(
                    "SELECT id, address, COALESCE(NULLIF(contact_name, ''), address) as contact_name, date FROM messages WHERE id = ?",
                    (msg_id,)
                ).fetchone()
                if not target:
                    self.send_cors_and_json({"error": "Message not found"}, 404)
                    return

                addr = target["address"]
                c_name = target["contact_name"]
                dt = target["date"]

                q_before = """
                    SELECT id, address, contact_name, type, date, body, media_type
                    FROM messages
                    WHERE address = ? AND date <= ? AND record_type IN (1, 2)
                    ORDER BY date DESC LIMIT 25
                """
                before_rows = list(reversed(cur.execute(q_before, (addr, dt)).fetchall()))

                q_after = """
                    SELECT id, address, contact_name, type, date, body, media_type
                    FROM messages
                    WHERE address = ? AND date > ? AND record_type IN (1, 2)
                    ORDER BY date ASC LIMIT 25
                """
                after_rows = list(cur.execute(q_after, (addr, dt)).fetchall())

                combined = [dict(r) for r in (before_rows + after_rows)]
                self.send_cors_and_json({
                    "target_id": int(msg_id),
                    "address": addr,
                    "contact_name": c_name,
                    "messages": combined
                })
                return

            self.send_cors_and_json({"error": "Not found"}, 404)
        finally:
            conn.close()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/")
        if path.startswith("/api"):
            path = path[4:]

        user_id = None
        session_token = None
        if REQUIRE_AUTH:
            user_id, session_token = auth.authenticate(self.headers)
            if not user_id:
                self.send_cors_and_json({"error": "Unauthorized"}, 401)
                return

        if path in ("/upload", "/api/upload"):
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                if content_length <= 0:
                    self.send_cors_and_json({"error": "Invalid or missing Content-Length"}, 400)
                    return

                if content_length > MAX_UPLOAD_SIZE:
                    max_gb = MAX_UPLOAD_SIZE // (1024 * 1024 * 1024)
                    self.send_cors_and_json({
                        "error": f"Upload exceeds maximum allowable size of {max_gb} GB"
                    }, 413)
                    return

                filename = self.headers.get("X-Filename", "backup.xml")
                clean_filename = os.path.basename(filename)
                effective_user_id = user_id or "default"

                current_prog = get_upload_progress(effective_user_id)
                if current_prog.get("status") in ("receiving", "parsing", "importing"):
                    self.send_cors_and_json({
                        "error": "An import is already running for your account. Please wait for it to complete."
                    }, status=409)
                    return

                update_upload_progress(effective_user_id, {
                    "status": "receiving",
                    "total_messages": 0,
                    "processed_messages": 0,
                    "filename": clean_filename
                })

                tmp_filename = f"upload_{effective_user_id}_{int(time.time())}_{secrets.token_hex(4)}.xml"
                tmp_path = os.path.join(CACHE_DIR, tmp_filename)

                # Stream the uploaded body directly to disk
                remaining = content_length
                chunk_size = 1024 * 1024  # 1 MB chunk
                with open(tmp_path, "wb") as f:
                    while remaining > 0:
                        to_read = min(chunk_size, remaining)
                        chunk = self.rfile.read(to_read)
                        if not chunk:
                            raise IOError("Client disconnected prematurely while uploading.")
                        f.write(chunk)
                        remaining -= len(chunk)

                # Acknowledge receipt to browser so xhr.onload completes
                self.send_cors_and_json({
                    "status": "received",
                    "message": "File received successfully. Ingesting records..."
                })

                # Launch ingestion in background thread
                def bg_import():
                    try:
                        db_path = get_user_db_path(effective_user_id, create_if_missing=True)
                        def on_progress(p):
                            update_upload_progress(effective_user_id, p)

                        res = ingest.parse_and_import_xml(db_path, tmp_path, progress_callback=on_progress)
                        if res.get("error"):
                            update_upload_progress(effective_user_id, {
                                "status": "error",
                                "error_message": res["error"],
                                "processed_messages": res.get("messages", 0)
                            })
                        else:
                            update_upload_progress(effective_user_id, {
                                "status": "completed",
                                "total_messages": res.get("messages", 0),
                                "processed_messages": res.get("messages", 0),
                                "total_calls": res.get("calls", 0),
                                "processed_calls": res.get("calls", 0),
                                "skipped": res.get("skipped", 0)
                            })
                            contacts.refresh_contacts_cache(effective_user_id)
                            threading.Thread(target=analytics.get_user_analytics, args=(effective_user_id,), daemon=True).start()
                    except Exception as err:
                        print(f"Ingestion error for user {effective_user_id}: {err}")
                        update_upload_progress(effective_user_id, {
                            "status": "error",
                            "error_message": str(err)
                        })
                    finally:
                        if os.path.exists(tmp_path):
                            try:
                                os.remove(tmp_path)
                            except Exception:
                                pass

                threading.Thread(target=bg_import, daemon=True).start()
                return
            except Exception as e:
                print(f"Error handling upload: {e}")
                update_upload_progress(user_id or "default", {"status": "error", "error_message": str(e)})
                self.send_cors_and_json({"error": f"Upload failed: {e}"}, 500)
                return

        if path == "/refresh":
            contacts.refresh_contacts_cache(user_id)
            self.send_cors_and_json({"status": "indexing_started"})
            return

        self.send_cors_and_json({"error": "Not found"}, 404)

    def log_message(self, format, *args):
        return


def warmup():
    """Warms up contacts and analytics cache for the most recently active session."""
    if not os.path.exists(AUTH_DB):
        return
    try:
        uri = f"file:{AUTH_DB}?mode=ro"
        conn = sqlite3.connect(uri, uri=True, timeout=2.0)
        cur = conn.cursor()
        row = cur.execute(
            "SELECT user_id FROM sessions ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
        conn.close()
        if row and row[0]:
            print(f"Warming up cache for most recent user: {row[0]}")
            contacts.refresh_contacts_cache(row[0])
            threading.Thread(target=analytics.get_user_analytics, args=(row[0],), daemon=True).start()
    except Exception as e:
        print(f"Warmup error: {e}")


def run():
    print(f"Starting Rekall daemon on port {PORT}...")
    print(f"Reading auth database at: {AUTH_DB}")
    print(f"Serving static frontend from: {STATIC_DIR}")
    print(f"Session authentication: {'ENABLED' if REQUIRE_AUTH else 'DISABLED'}")

    init_auth_db()
    warmup()

    server = ThreadingHTTPServer(("0.0.0.0", PORT), SMSHandler)
    server.serve_forever()


if __name__ == "__main__":
    run()

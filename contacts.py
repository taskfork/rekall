"""
Contact indexing, aggregation, and caching for Rekall.
"""

import re
import threading
import time

from config import get_db

user_caches = {}
user_lock = threading.Lock()

# Registered cache invalidators (e.g. analytics cache)
_cache_invalidators = []


def register_cache_invalidator(fn):
    """Register a callback fn(user_id) to be called when contacts cache is invalidated."""
    _cache_invalidators.append(fn)


def get_or_index_contacts(user_id):
    """Returns (contacts_list, is_indexing_bool). Triggers indexing if not yet indexed."""
    with user_lock:
        if user_id not in user_caches:
            user_caches[user_id] = {
                "contacts": [],
                "phone_map": {},
                "last_indexed": 0,
                "indexing": False
            }
        entry = user_caches[user_id]

    if not entry["contacts"] and not entry["indexing"]:
        refresh_contacts_cache(user_id)

    return entry["contacts"], entry["indexing"]


def get_phone_map(user_id):
    """Returns phone -> display_name dict from cache, or empty dict if not indexed."""
    with user_lock:
        if user_id not in user_caches:
            user_caches[user_id] = {
                "contacts": [],
                "phone_map": {},
                "last_indexed": 0,
                "indexing": False
            }
        entry = user_caches[user_id]

    if not entry.get("phone_map") and not entry["indexing"] and not entry["contacts"]:
        refresh_contacts_cache(user_id)

    return entry.get("phone_map", {})


def refresh_contacts_cache(user_id):
    """Forces an asynchronous background re-indexing of all contacts for a user."""
    with user_lock:
        for inv in _cache_invalidators:
            try:
                inv(user_id)
            except Exception:
                pass
        if user_id not in user_caches:
            user_caches[user_id] = {"contacts": [], "phone_map": {}, "last_indexed": 0, "indexing": False}
        if user_caches[user_id]["indexing"]:
            return
        user_caches[user_id]["indexing"] = True

    def _worker():
        try:
            conn = get_db(user_id)
            if not conn:
                with user_lock:
                    user_caches[user_id]["contacts"] = []
                    user_caches[user_id]["phone_map"] = {}
                    user_caches[user_id]["last_indexed"] = time.time()
                return
            cur = conn.cursor()
            t0 = time.time()

            phone_pattern = re.compile(r'^\+?[\d,\s\-()]+$')
            query = """
                SELECT 
                    address, 
                    MAX(CASE WHEN contact_name IS NOT NULL AND contact_name != '' AND contact_name != '(Unknown)' THEN contact_name ELSE NULL END) as best_name, 
                    count(*) as count, 
                    max(date) as last_date
                FROM messages 
                WHERE record_type IN (1, 2) 
                GROUP BY address 
                ORDER BY last_date DESC;
            """
            rows = cur.execute(query).fetchall()

            # Build phone -> name mapping to resolve group members and individual senders
            phone_to_name = {}
            for r in rows:
                addr = r["address"]
                raw_name = r["best_name"]
                if ',' not in addr and raw_name and raw_name != '(Unknown)' and not phone_pattern.match(raw_name):
                    phone_to_name[addr] = raw_name

            sender_rows = cur.execute("""
                SELECT sender, MAX(contact_name) as cname
                FROM messages
                WHERE sender != '' AND sender IS NOT NULL AND contact_name IS NOT NULL AND contact_name != '' AND contact_name != '(Unknown)'
                GROUP BY sender;
            """).fetchall()
            for sr in sender_rows:
                s_addr = sr["sender"]
                c_name = sr["cname"]
                if s_addr and c_name and not phone_pattern.match(c_name) and s_addr not in phone_to_name:
                    phone_to_name[s_addr] = c_name

            results = []
            for r in rows:
                raw_name = r["best_name"]
                addr = r["address"]
                is_group = ',' in addr

                if is_group:
                    if raw_name and raw_name != '(Unknown)' and not phone_pattern.match(raw_name) and raw_name != addr:
                        display_name = raw_name
                        is_unknown = False
                    else:
                        members = [a.strip() for a in addr.split(',') if a.strip()]
                        resolved_members = [phone_to_name.get(m, m) for m in members]
                        display_name = ", ".join(resolved_members)
                        is_unknown = all(phone_pattern.match(m) for m in resolved_members)
                else:
                    is_unknown = bool(
                        not raw_name or 
                        raw_name == '(Unknown)' or 
                        raw_name == addr or 
                        phone_pattern.match(raw_name)
                    )
                    display_name = raw_name if not is_unknown else phone_to_name.get(addr, addr)
                    if display_name != addr and not phone_pattern.match(display_name):
                        is_unknown = False

                results.append({
                    "address": addr,
                    "name": display_name,
                    "is_unknown": is_unknown,
                    "is_group": is_group,
                    "count": r["count"],
                    "last_date": r["last_date"]
                })

            with user_lock:
                user_caches[user_id]["contacts"] = results
                user_caches[user_id]["phone_map"] = phone_to_name
                user_caches[user_id]["last_indexed"] = time.time()
            print(f"[{time.strftime('%X')}] Indexed {len(results)} contacts for user {user_id} in {time.time() - t0:.2f}s")
            conn.close()
        except Exception as e:
            print(f"Error indexing contacts for user {user_id}: {e}")
        finally:
            with user_lock:
                user_caches[user_id]["indexing"] = False

    threading.Thread(target=_worker, daemon=True).start()

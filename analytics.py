"""
Analytics computation, aggregation, and caching for Rekall.
"""

import re
import threading

from config import get_db
import contacts

user_analytics_cache = {}
analytics_lock = threading.Lock()


def invalidate_user_analytics(user_id):
    """Clears the cached analytics metrics for a given user."""
    with analytics_lock:
        user_analytics_cache.pop(user_id, None)


# Register invalidator so contact indexing triggers analytics invalidation
contacts.register_cache_invalidator(invalidate_user_analytics)


def get_user_analytics(user_id):
    """Computes or retrieves cached archive statistics for a user."""
    with analytics_lock:
        if user_id in user_analytics_cache:
            return user_analytics_cache[user_id]

    conn = get_db(user_id)
    if not conn:
        return {
            "summary": {
                "total_messages": 0, "sms_count": 0, "mms_count": 0,
                "sent": 0, "received": 0, "media_count": 0,
                "first_date": 0, "last_date": 0, "span_years": 0
            },
            "timeline": [],
            "hourly": [0] * 24,
            "top_contacts": []
        }

    try:
        cur = conn.cursor()

        # 1. Summary stats
        summary_query = """
            SELECT
                COUNT(*) as total,
                COALESCE(SUM(CASE WHEN record_type = 1 THEN 1 ELSE 0 END), 0) as sms_count,
                COALESCE(SUM(CASE WHEN record_type = 2 THEN 1 ELSE 0 END), 0) as mms_count,
                COALESCE(SUM(CASE WHEN record_type IN (1,2) AND type = 2 THEN 1 ELSE 0 END), 0) as sent,
                COALESCE(SUM(CASE WHEN record_type IN (1,2) AND type = 1 THEN 1 ELSE 0 END), 0) as received,
                COALESCE(SUM(CASE WHEN record_type = 2 THEN 1 ELSE 0 END), 0) as media_count,
                MIN(date) as first_date,
                MAX(date) as last_date
            FROM messages
            WHERE record_type IN (1, 2);
        """
        row = cur.execute(summary_query).fetchone()

        total = row["total"] or 0
        sms_count = row["sms_count"] or 0
        mms_count = row["mms_count"] or 0
        sent = row["sent"] or 0
        received = row["received"] or 0
        media_count = row["media_count"] or 0
        first_date = row["first_date"] or 0
        last_date = row["last_date"] or 0

        first_ts = first_date if first_date < 1e11 else first_date // 1000
        last_ts = last_date if last_date < 1e11 else last_date // 1000
        span_years = round((last_ts - first_ts) / (365.25 * 86400), 1) if last_ts > first_ts else 0

        # 2. Monthly timeline
        monthly_query = """
            SELECT 
                strftime('%Y-%m', date, 'unixepoch', 'localtime') as ym,
                COUNT(*) as total,
                SUM(CASE WHEN type = 2 THEN 1 ELSE 0 END) as sent,
                SUM(CASE WHEN type = 1 THEN 1 ELSE 0 END) as received
            FROM messages
            WHERE record_type IN (1, 2)
            GROUP BY ym
            ORDER BY ym ASC;
        """
        monthly_rows = cur.execute(monthly_query).fetchall()
        timeline = [
            {
                "date": r["ym"],
                "total": r["total"],
                "sent": r["sent"] or 0,
                "received": r["received"] or 0
            }
            for r in monthly_rows if r["ym"]
        ]

        # 3. 24-Hour distribution
        hourly_query = """
            SELECT 
                CAST(strftime('%H', date, 'unixepoch', 'localtime') AS INTEGER) as hr,
                COUNT(*) as count
            FROM messages
            WHERE record_type IN (1, 2)
            GROUP BY hr
            ORDER BY hr ASC;
        """
        hourly_rows = cur.execute(hourly_query).fetchall()
        hourly_map = {r["hr"]: r["count"] for r in hourly_rows if r["hr"] is not None}
        hourly_distribution = [hourly_map.get(h, 0) for h in range(24)]

        # 4. Top 10 contacts leaderboard
        top_query = """
            SELECT
                address,
                MAX(CASE WHEN contact_name IS NOT NULL AND contact_name != '' AND contact_name != '(Unknown)' THEN contact_name ELSE NULL END) as contact_name,
                COUNT(*) as total,
                SUM(CASE WHEN type = 2 THEN 1 ELSE 0 END) as sent,
                SUM(CASE WHEN type = 1 THEN 1 ELSE 0 END) as received
            FROM messages
            WHERE record_type IN (1, 2)
            GROUP BY address
            ORDER BY total DESC
            LIMIT 10;
        """
        top_rows = cur.execute(top_query).fetchall()
        phone_pattern = re.compile(r'^\+?[\d,\s\-()]+$')
        top_contacts = []
        for r in top_rows:
            addr = r["address"]
            raw_name = r["contact_name"]
            is_unk = not raw_name or raw_name == '(Unknown)' or raw_name == addr or phone_pattern.match(raw_name)
            disp_name = raw_name if not is_unk else addr
            top_contacts.append({
                "address": addr,
                "name": disp_name,
                "total": r["total"],
                "sent": r["sent"] or 0,
                "received": r["received"] or 0
            })

        data = {
            "summary": {
                "total_messages": total,
                "sms_count": sms_count,
                "mms_count": mms_count,
                "sent": sent,
                "received": received,
                "media_count": media_count,
                "first_date": first_ts,
                "last_date": last_ts,
                "span_years": span_years
            },
            "timeline": timeline,
            "hourly": hourly_distribution,
            "top_contacts": top_contacts
        }

        with analytics_lock:
            user_analytics_cache[user_id] = data

        return data
    finally:
        conn.close()

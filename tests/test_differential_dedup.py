"""
Differential Deduplication & Parser Tests for Rekall.

Ensures the native Python ingestion engine strictly mirrors the upstream
Go implementation (lowcarbdev/sbv) across deduplication, schema fidelity,
storage types, FTS5 triggers, and surrogate emoji sanitization.

Can be run via:
    pytest tests/
or:
    python3 -m unittest discover tests/
"""

import os
import sys
import json
import sqlite3
import tempfile
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import ingest

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
EDGE_XML = os.path.join(FIXTURES_DIR, "edge.xml")
EMOJI_XML = os.path.join(FIXTURES_DIR, "emoji.xml")
EXPECTED_JSON = os.path.join(FIXTURES_DIR, "expected_rows.json")


class TestDifferentialDeduplication(unittest.TestCase):

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp_dir.name, "test.db")
        ingest.init_user_db(self.db_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_edge_fixture_matches_expected_rows(self):
        """
        Ingesting the edge-case XML must produce rows bit-for-bit identical to
        the canonical output produced by the upstream Go implementation.
        """
        with open(EXPECTED_JSON, "r") as f:
            expected = json.load(f)

        stats = ingest.parse_and_import_xml(self.db_path, EDGE_XML)
        self.assertIsNone(stats["error"])
        self.assertEqual(stats["messages"], expected["import_stats"]["messages"])
        self.assertEqual(stats["calls"], expected["import_stats"]["calls"])
        self.assertEqual(stats["skipped"], expected["import_stats"]["skipped"])

        conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row

        cols = [r[1] for r in conn.execute("PRAGMA table_info(messages)") if r[1] != "id"]
        rows = []
        for row in conn.execute("SELECT * FROM messages ORDER BY record_type, address, date, id"):
            d = {}
            for col in cols:
                val = row[col]
                if col == "media_data" and val is not None:
                    d[col] = val.hex()
                else:
                    d[col] = val
            rows.append(d)

        self.assertEqual(len(rows), expected["total_rows"])
        self.assertEqual(rows, expected["rows"])

        # FTS5 search table must have exact matching row count
        fts_count = conn.execute("SELECT COUNT(*) FROM messages_fts").fetchone()[0]
        self.assertEqual(fts_count, expected["fts_count"])
        conn.close()

    def test_deduplication_idempotency(self):
        """
        Re-ingesting the exact same backup file must result in ZERO new rows
        due to idx_message_unique with ON CONFLICT DO NOTHING.
        """
        # First ingestion
        ingest.parse_and_import_xml(self.db_path, EDGE_XML)
        conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
        initial_count = conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
        conn.close()

        self.assertEqual(initial_count, 21)

        # Second ingestion: identical file re-imported
        res = ingest.parse_and_import_xml(self.db_path, EDGE_XML)
        self.assertIsNone(res["error"])

        conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
        final_count = conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
        final_fts_count = conn.execute("SELECT COUNT(*) FROM messages_fts").fetchone()[0]
        conn.close()

        self.assertEqual(final_count, initial_count)
        self.assertEqual(final_fts_count, initial_count)

    def test_surrogate_emoji_sanitization(self):
        """
        SMS Backup & Restore writes emoji as surrogate pairs (e.g. &#55357;&#56832;).
        Expat rejects these by default; our SurrogateSafeReader replaces them with
        U+FFFD matching Go's exact storage behavior.
        """
        res = ingest.parse_and_import_xml(self.db_path, EMOJI_XML)
        self.assertIsNone(res["error"])

        conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
        rows = conn.execute(
            "SELECT body, hex(CAST(body AS blob)) FROM messages WHERE address='+15559990001' ORDER BY date"
        ).fetchall()
        conn.close()

        self.assertEqual(len(rows), 2)
        # Body contains 'before  after' (UTF-8 hex ending with EFBFBDEFBFBD)
        self.assertEqual(rows[0][0], "before \ufffd\ufffd after")
        self.assertEqual(rows[0][1], "6265666F726520EFBFBDEFBFBD206166746572")

    def test_fts5_full_text_search(self):
        """
        Verify FTS5 virtual table queries return the correct records.
        """
        ingest.parse_and_import_xml(self.db_path, EDGE_XML)
        conn = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)

        # Search for 'padded' in body
        results = conn.execute(
            "SELECT m.body, m.address FROM messages_fts f JOIN messages m ON f.rowid = m.id WHERE messages_fts MATCH 'padded'"
        ).fetchall()
        self.assertGreaterEqual(len(results), 1)
        self.assertIn("padded", results[0][0])
        conn.close()


if __name__ == "__main__":
    unittest.main()

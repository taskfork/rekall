"""
Tests for group chat resolution and phone mapping in Rekall.
"""

import os
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch

import contacts
import ingest


class TestGroupContacts(unittest.TestCase):

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp_dir.name, "test.db")
        ingest.init_user_db(self.db_path)
        self.conn = sqlite3.connect(self.db_path)

    def tearDown(self):
        self.conn.close()
        self.temp_dir.cleanup()

    def test_group_name_resolution_and_phone_mapping(self):
        cur = self.conn.cursor()
        # Insert 1-on-1 contact Alice
        cur.execute("""
            INSERT INTO messages (record_type, address, type, date, body, contact_name)
            VALUES (1, '+15551112222', 1, 1000, 'Hey there', 'Alice Smith')
        """)
        # Insert 1-on-1 contact Bob
        cur.execute("""
            INSERT INTO messages (record_type, address, type, date, body, contact_name)
            VALUES (1, '+15553334444', 1, 1005, 'Hello', 'Bob Jones')
        """)
        # Insert group chat with Alice, Bob, and unknown person +15559998888
        group_address = "+15551112222,+15553334444,+15559998888"
        cur.execute("""
            INSERT INTO messages (record_type, address, type, date, body, contact_name, sender)
            VALUES (2, ?, 1, 1010, 'Group plan', '', '+15551112222')
        """, (group_address,))
        self.conn.commit()

        # Mock get_db in contacts to return our test db
        def mock_get_db(user_id):
            c = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
            c.row_factory = sqlite3.Row
            return c

        with patch("contacts.get_db", side_effect=mock_get_db):
            contacts.refresh_contacts_cache("test_user")
            # Wait for worker thread to complete
            for _ in range(50):
                cached, indexing = contacts.get_or_index_contacts("test_user")
                if cached and not indexing:
                    break
                time.sleep(0.05)

            phone_map = contacts.get_phone_map("test_user")
            self.assertEqual(phone_map.get("+15551112222"), "Alice Smith")
            self.assertEqual(phone_map.get("+15553334444"), "Bob Jones")

            # Check group contact item
            group_item = next((c for c in cached if c["address"] == group_address), None)
            self.assertIsNotNone(group_item)
            self.assertTrue(group_item["is_group"])
            self.assertFalse(group_item["is_unknown"])
            # Alice and Bob should be resolved to names, while the 3rd remains the phone number
            self.assertEqual(group_item["name"], "Alice Smith, Bob Jones, +15559998888")


if __name__ == "__main__":
    unittest.main()

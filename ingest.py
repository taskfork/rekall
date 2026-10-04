"""
Streaming SMS Backup & Restore XML importer for Rekall.

Port of the ingestion logic from lowcarbdev/sbv (internal/parser.go,
internal/utils.go, internal/database.go). Row semantics intentionally mirror the
Go implementation so databases written by either engine are interchangeable and
deduplicate against each other via the idx_message_unique index.
"""
import base64
import gc
import re
import sqlite3
import xml.etree.ElementTree as ET

_INT_RE = re.compile(r"^[+-]?[0-9]+$")


def atoi(s, default=0):
    """Go strconv.Atoi semantics as used upstream: errors are ignored -> 0."""
    if s is None:
        return default
    return int(s) if _INT_RE.match(s) else default


def parse_int64(s):
    """Go strconv.ParseInt(s, 10, 64); raises ValueError on failure (row is skipped)."""
    if s is None or not _INT_RE.match(s):
        raise ValueError(f"invalid integer {s!r}")
    return int(s)


def unix_seconds(date_ms: int) -> int:
    # Go integer division truncates toward zero
    return -((-date_ms) // 1000) if date_ms < 0 else date_ms // 1000


def normalize_phone_number(phone_number: str) -> str:
    """Port of normalizePhoneNumber (utils.go). ASCII digits only."""
    if not phone_number:
        return ""
    has_plus = phone_number.startswith("+")
    digits = "".join(ch for ch in phone_number if "0" <= ch <= "9")
    if not digits:
        return ""
    if not has_plus:
        if len(digits) == 10:
            return "+1" + digits
        if len(digits) == 11 and digits[0] == "1":
            return "+" + digits
        return digits
    return "+" + digits


def normalize_null_string(s: str) -> str:
    """Port of normalizeNullString: only the literal 'null' collapses; others untouched."""
    if (s or "").strip().lower() == "null":
        return ""
    return s or ""


def _ct(content_type: str) -> str:
    return (content_type or "").strip().lower()


def is_text_content_type(content_type: str) -> bool:
    ct = _ct(content_type)
    return ct.startswith("text/") or ct in ("application/xml", "application/json")


def is_smil_content_type(content_type: str) -> bool:
    ct = _ct(content_type)
    return ct == "application/smil" or ct.startswith("application/smil+") or "smil" in ct


def is_vcard_content_type(content_type: str) -> bool:
    return _ct(content_type) in ("text/vcard", "text/x-vcard", "text/directory")


def _b64(data: str):
    """Strict base64 like Go's StdEncoding (which ignores only CR/LF). None on failure."""
    try:
        return base64.b64decode(data.replace("\r", "").replace("\n", ""), validate=True)
    except Exception:
        return None


# Row layout shared by SMS and MMS (matches MESSAGE_INSERT_SQL column order):
# (record_type, address, body, type, date, read, thread_id, subject, media_type,
#  media_data, protocol, status, service_center, sub_id, contact_name, sender,
#  content_type, read_report, read_status, message_id, message_size,
#  message_type, sim_slot, addresses)

def convert_sms_entry(attrib: dict) -> tuple:
    """Port of convertSMSEntry + InsertMessage argument shaping. Raises ValueError to skip."""
    date_sec = unix_seconds(parse_int64(attrib.get("date")))
    msg_type = atoi(attrib.get("type"))
    norm_addr = normalize_phone_number(attrib.get("address", ""))
    sender = norm_addr if (msg_type == 1 and norm_addr) else ""

    return (
        1,  # no ContentType -> SMS
        norm_addr,
        attrib.get("body", ""),
        msg_type,
        date_sec,
        1 if attrib.get("read") == "1" else 0,
        atoi(attrib.get("thread_id")),
        normalize_null_string(attrib.get("subject", "")),
        "",    # media_type
        None,  # media_data
        atoi(attrib.get("protocol")),
        atoi(attrib.get("status")),
        attrib.get("service_center", ""),
        atoi(attrib.get("sub_id")),
        attrib.get("contact_name", ""),
        sender,
        "",    # content_type
        0, 0, "", 0, 0, 0,
        norm_addr,
    )


def convert_mms_entry(elem) -> tuple:
    """Port of convertMMSEntry + InsertMessage argument shaping. Raises ValueError to skip."""
    attrib = elem.attrib
    date_sec = unix_seconds(parse_int64(attrib.get("date")))
    msg_type = atoi(attrib.get("msg_box"))
    norm_addr = normalize_phone_number(attrib.get("address", ""))

    address_set = set()
    sender_address = ""
    first_address = ""
    addrs_elem = elem.find("addrs")
    if addrs_elem is not None:
        for a in addrs_elem.findall("addr"):
            raw = a.attrib.get("address", "")
            if not raw:
                continue
            n = normalize_phone_number(raw)
            if not n:
                continue
            address_set.add(n)
            if not first_address:
                first_address = n
            if atoi(a.attrib.get("type")) == 137:  # FROM
                sender_address = n

    if msg_type == 1 and not sender_address and first_address and address_set:
        sender_address = first_address

    addresses = sorted(address_set)
    primary_address = ",".join(addresses) if len(addresses) >= 3 else norm_addr
    sender = sender_address if (msg_type == 1 and sender_address) else ""

    body_text = ""
    media_type = ""
    media_data = None
    parts_elem = elem.find("parts")
    if parts_elem is not None:
        for part in parts_elem.findall("part"):
            ct = part.attrib.get("ct", "")
            if is_smil_content_type(ct):
                continue
            data = part.attrib.get("data", "")
            text = part.attrib.get("text", "")

            if is_vcard_content_type(ct) and data:
                if media_type == "":
                    decoded = _b64(data)
                    if decoded is not None:
                        media_type, media_data = ct, decoded
                continue

            if ct != "" and data != "" and not is_text_content_type(ct):
                if media_type == "":
                    decoded = _b64(data)
                    if decoded is not None:
                        media_type, media_data = ct, decoded
            elif text != "" and normalize_null_string(text) != "":
                body_text += text + " "

    body = body_text.strip() if body_text else ""

    content_type = attrib.get("ct_t", "")
    return (
        2 if content_type != "" else 1,  # InsertMessage: record_type from ContentType
        primary_address,
        body,
        msg_type,
        date_sec,
        1 if attrib.get("read") == "1" else 0,
        atoi(attrib.get("thread_id")),
        normalize_null_string(attrib.get("sub", "")),
        media_type,
        media_data,
        0, 0, "", 0,
        attrib.get("contact_name", ""),
        sender,
        content_type,
        atoi(attrib.get("rr")),
        atoi(attrib.get("read_status")),
        attrib.get("m_id", ""),
        atoi(attrib.get("m_size")),
        atoi(attrib.get("m_type")),
        atoi(attrib.get("sim_slot")),
        ",".join(addresses),
    )


_SURROGATE_REF = re.compile(rb"&#(?:[xX]([0-9a-fA-F]{1,6})|([0-9]{1,7}));")


def _fix_ref(m):
    n = int(m.group(1), 16) if m.group(1) else int(m.group(2))
    # Android writes emoji as two surrogate char refs (e.g. &#55357;&#56832;),
    # which expat rejects. Go's decoder accepts them and stores U+FFFD for each;
    # we do the same byte-for-byte so re-imports dedupe against existing rows.
    return b"&#65533;" if 0xD800 <= n <= 0xDFFF else m.group(0)


class SurrogateSafeReader:
    """File wrapper that rewrites surrogate character references in a chunk-safe way."""

    def __init__(self, path, chunk=1 << 20):
        self._f = open(path, "rb")
        self._chunk = chunk
        self._carry = b""

    def read(self, n=-1):
        while True:
            data = self._f.read(self._chunk)
            buf = self._carry + data
            self._carry = b""
            if data:
                # hold back a possibly incomplete trailing "&#...;" reference
                amp = buf.rfind(b"&", max(0, len(buf) - 16))
                if amp != -1 and b";" not in buf[amp:]:
                    self._carry, buf = buf[amp:], buf[:amp]
            out = _SURROGATE_REF.sub(_fix_ref, buf)
            # An empty return would be read as EOF by the parser; only allow it at real EOF.
            if out or not data:
                return out

    def close(self):
        self._f.close()


def convert_call_entry(elem) -> tuple:
    """Port of convertCallEntry + InsertCallLog. Raises ValueError to skip."""
    a = elem.attrib
    return (
        3,
        normalize_phone_number(a.get("number", "")),
        atoi(a.get("type")),
        unix_seconds(parse_int64(a.get("date"))),
        atoi(a.get("duration")),
        atoi(a.get("presentation")),
        a.get("subscription_id", ""),
        a.get("contact_name", ""),
    )


MESSAGE_INSERT_SQL = """
    INSERT INTO messages (
        record_type, address, body, type, date, read, thread_id, subject, media_type, media_data,
        protocol, status, service_center, sub_id, contact_name, sender,
        content_type, read_report, read_status, message_id, message_size, message_type, sim_slot, addresses
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING
"""

CALL_INSERT_SQL = """
    INSERT INTO messages (
        record_type, address, type, date, duration, presentation, subscription_id, contact_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING
"""

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_type INTEGER NOT NULL DEFAULT 1,
    address TEXT NOT NULL,
    body TEXT,
    type INTEGER NOT NULL,
    date INTEGER NOT NULL,
    read INTEGER DEFAULT 0,
    thread_id INTEGER,
    subject TEXT,
    media_type TEXT,
    media_data BLOB,
    protocol INTEGER,
    status INTEGER,
    service_center TEXT,
    sub_id INTEGER,
    contact_name TEXT,
    sender TEXT,
    content_type TEXT,
    read_report INTEGER,
    read_status INTEGER,
    message_id TEXT,
    message_size INTEGER,
    message_type INTEGER,
    sim_slot INTEGER,
    addresses TEXT,
    duration INTEGER,
    presentation INTEGER,
    subscription_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_address ON messages(address);
CREATE INDEX IF NOT EXISTS idx_date ON messages(date);
CREATE INDEX IF NOT EXISTS idx_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_record_type ON messages(record_type);
CREATE INDEX IF NOT EXISTS idx_record_type_date ON messages(record_type, date);
CREATE INDEX IF NOT EXISTS idx_address_date ON messages(address, date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_unique ON messages(
    record_type, address, date, type,
    COALESCE(body, ''), COALESCE(content_type, ''),
    COALESCE(message_id, ''), COALESCE(duration, 0)
);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    message_id UNINDEXED,
    address UNINDEXED,
    body,
    contact_name UNINDEXED,
    date UNINDEXED,
    content='messages',
    content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, message_id, address, body, contact_name, date)
    VALUES (new.id, new.id, new.address, new.body, new.contact_name, new.date);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, message_id, address, body, contact_name, date)
    VALUES('delete', old.id, old.id, old.address, old.body, old.contact_name, old.date);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, message_id, address, body, contact_name, date)
    VALUES('delete', old.id, old.id, old.address, old.body, old.contact_name, old.date);
    INSERT INTO messages_fts(rowid, message_id, address, body, contact_name, date)
    VALUES (new.id, new.id, new.address, new.body, new.contact_name, new.date);
END;
"""


def init_user_db(db_path: str):
    conn = sqlite3.connect(db_path, timeout=30.0)
    try:
        conn.executescript(SCHEMA_SQL)
        conn.commit()
    finally:
        conn.close()


def parse_and_import_xml(db_path: str, xml_file_path: str, progress_callback=None, batch_size=500):
    """
    Stream-parse a backup file and insert rows in batched transactions.

    Duplicates are dropped by SQLite (ON CONFLICT DO NOTHING against
    idx_message_unique). Malformed individual entries are skipped and counted,
    like upstream; a malformed XML document aborts the import (already committed
    batches are kept, the in-flight batch is rolled back).
    """
    init_user_db(db_path)
    conn = sqlite3.connect(db_path, timeout=30.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    cur = conn.cursor()

    total_messages = 0
    total_calls = 0
    message_count = 0
    call_count = 0
    skipped = 0
    msg_batch, call_batch = [], []

    def report(status="importing", error_message=None):
        if progress_callback:
            data = {
                "status": status,
                "total_messages": total_messages,
                "processed_messages": message_count,
                "total_calls": total_calls,
                "processed_calls": call_count,
                "skipped": skipped,
            }
            if error_message:
                data["error_message"] = error_message
            progress_callback(data)

    def flush():
        # One transaction per flush so messages+calls commit atomically.
        if msg_batch:
            cur.executemany(MESSAGE_INSERT_SQL, msg_batch)
        if call_batch:
            cur.executemany(CALL_INSERT_SQL, call_batch)
        conn.commit()
        msg_batch.clear()
        call_batch.clear()

    def read_count(attrib):
        v = attrib.get("count", "0")
        return int(v) if v.isdigit() else 0

    source = None
    try:
        source = SurrogateSafeReader(xml_file_path)
        context = iter(ET.iterparse(source, events=("start", "end")))
        _, root = next(context)  # root start event
        if root.tag == "smses":
            total_messages = read_count(root.attrib)
        elif root.tag == "calls":
            total_calls = read_count(root.attrib)
        report("parsing")

        for event, elem in context:
            if event == "start":
                continue
            tag = elem.tag
            if tag not in ("sms", "mms", "call"):
                continue
            try:
                if tag == "sms":
                    msg_batch.append(convert_sms_entry(elem.attrib))
                    message_count += 1
                elif tag == "mms":
                    msg_batch.append(convert_mms_entry(elem))
                    message_count += 1
                else:
                    call_batch.append(convert_call_entry(elem))
                    call_count += 1
            except ValueError:
                skipped += 1
            finally:
                elem.clear()
                root.clear()

            if len(msg_batch) + len(call_batch) >= batch_size:
                flush()
                report("importing")
                if message_count % 2000 < batch_size:
                    gc.collect()

        flush()
        gc.collect()
        report("completed")
        return {"messages": message_count, "calls": call_count, "skipped": skipped, "error": None}

    except Exception as e:
        conn.rollback()
        report("error", error_message=str(e))
        return {"messages": message_count, "calls": call_count, "skipped": skipped, "error": str(e)}
    finally:
        if source is not None:
            source.close()
        conn.close()

# Rekall

**Rekall** is a lightweight, high-performance web viewer, analytics dashboard, and ingestion engine for Android SMS Backup & Restore archives (SMS, MMS, and call logs).

Designed for large archives (tested on 685,000+ messages and 12+ GB SQLite databases) with sub-second timeline rendering, instant full-text search, and a memory-safe streaming parser.

> [!NOTE]
> **Disclaimer — Vibecoded Project:** This entire application was vibecoded with AI assistance to solve a personal homelab need for browsing and analyzing multi-year SMS/MMS backup archives. While it has been battle-tested on real-world 12+ GB databases (685k+ messages) and is guarded by automated differential test suites, expect quirks, AI idioms, and opinionated shortcuts. Provided as-is — use at your own risk. Feedback and PRs are welcome!

---

## Features

- **Streaming XML Ingestion Engine**:
  - Memory-safe `xml.etree.ElementTree.iterparse` with aggressive element clearing (<50MB RAM footprint even on multi-GB XML backups).
  - Handles surrogate character references (emoji encoding) produced by SMS Backup & Restore (`&#55357;&#56832;`).
  - Bit-for-bit duplicate elimination via SQLite `idx_message_unique` constraint with `ON CONFLICT DO NOTHING`.
  - Real-time in-memory progress reporting (`/api/progress`) with live processed message/call counters.
- **Ultra-Fast Timeline & Search**:
  - SQLite FTS5 full-text search with automatic insert/update/delete triggers.
  - Asynchronous background contact indexing with in-memory caching.
  - Infinite scroll message viewer supporting group MMS, vCards, audio, and video attachments.
- **Image Orientation & Thumbnails**:
  - In-memory Pillow resizing with automatic `ImageOps.exif_transpose` to fix sideways/rotated phone photos.
- **Analytics & Stats Dashboard**:
  - Summary metrics (total messages, sent/received ratio, span in years, MMS counts).
  - Multi-year activity charts, day-of-week & 24-hour distribution heatmaps, and top contact statistics.
- **Security & Multi-Tenancy**:
  - Native OpenID Connect (OIDC) authentication supporting Authelia, Authentik, Keycloak, or generic OIDC providers.
  - Isolated per-user SQLite databases (`data/sbv_<uuid>.db` or `data/rekall_<uuid>.db`).
  - Secure session cookie management.

---

## Architecture & Technology

- **Backend**: Python 3.12 (standard library `http.server`, `sqlite3`, `xml.etree.ElementTree`) + `Pillow` for thumbnail generation.
- **Database**: SQLite in WAL mode (`PRAGMA synchronous=NORMAL`) with FTS5 virtual tables.
- **Frontend**: Clean single-page application using Tailwind CSS and DaisyUI.
- **Footprint**: Minimal alpine container (~70MB image size, <60MB runtime RAM).

---

## Quick Start (Docker Compose)

```yaml
services:
  rekall:
    container_name: rekall
    image: rekall:local
    build: .
    restart: unless-stopped
    ports:
      - "127.0.0.1:3089:3089"
    environment:
      - DATA_DIR=/data
      - CACHE_DIR=/cache
      - PORT=3089
      - STATIC_DIR=/app/static
      - PYTHONUNBUFFERED=1
    env_file:
      - .env
    volumes:
      - ./data:/data
      - ./cache:/cache
```

### Environment Configuration (`.env`)

```ini
PUID=1000
PGID=1000
SECURE_COOKIES=true
OIDC_ISSUER_URL=https://auth.example.com
OIDC_CLIENT_ID=rekall
OIDC_CLIENT_SECRET=your_client_secret
OIDC_REDIRECT_URL=https://rekall.example.com/api/auth/oidc/callback
OIDC_PROVIDER_NAME=Authelia
```

---

## Attribution

Rekall's database schema and deduplication model are compatible with and inspired by the original work in [sms-backup-viewer (SBV)](https://github.com/lowcarbdev/sbv) by lowcarbdev.

---

## License

[MIT](LICENSE) © 2026 taskfork

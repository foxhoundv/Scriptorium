# ScribeFlow — Self-Hosted Writing Workspace

> Current version: **v2.4**
> A Scrivener-inspired writing application designed to run entirely on your own server via Docker or Proxmox LXC. No subscriptions, no cloud, no external dependencies at runtime.

---

## Table of Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [Deployment: Docker](#deployment-docker)
- [Deployment: Proxmox LXC](#deployment-proxmox-lxc)
- [Bible Data Setup](#bible-data-setup)
- [Multi-User SSO](#multi-user-sso)
- [Updating ScribeFlow](#updating-scribeflow)
- [API Reference](#api-reference)
- [Data Storage](#data-storage)
- [Reverse Proxy](#reverse-proxy-optional)
- [Version History](#version-history)

---

## Features

### Writing

- **Binder** — Hierarchical project tree with folders, documents, and drag-resize sidebar
- **Rich Text Editor** — Full formatting toolbar: bold, italic, underline, headings, blockquotes, lists, dividers
- **Inspector Panel** — Per-document synopsis, notes, label, status, compile flag, and target word count
- **Corkboard View** — Visual index-card overview of all scenes and chapters
- **Auto-Save** — Saves to the server automatically as you type (1.5 s debounce)
- **Word Count & Statistics** — Live word count, character count, reading time, and progress toward per-document and project targets
- **Dark Mode** — Toggle between light and dark themes
- **Distraction-Free Mode** — Hides all UI chrome; press Escape to return
- **Keyboard Shortcuts** — `Ctrl+S` save, `Ctrl+,` settings, `Escape` exit focus mode

### Projects

- **Document Styles** — Choose a template when creating a project; sets up the Binder folder structure automatically. Available styles:
  - **Novel** — Manuscript, Research, Characters, Places
  - **Screenplay** — Act I, Act II, Act III, Characters, Research
  - **Non-Fiction** — Chapters, Research, Sources, Notes
  - **Short Story** — Story, Research, Notes
  - **Poetry** — Poems, Drafts, Inspiration
  - **Research** — Topics, Sources, Notes, References *(unlocks Research Type)*
  - **Blank** — Single Documents folder
- **Document style is locked after first save** — create a new project to use a different style
- **Research Type** — Available only for Research-style projects. Choose between:
  - **Academics** — standard layout
  - **Pastoral Sermons** — adds a live Bible scripture pane to the editor (see [Bible Data Setup](#bible-data-setup))
- **Project type labels** — the home screen shows each project's style and sub-type next to the title

### Project Settings

Accessible from the toolbar (⚙) or by hovering a project card on the home screen. Tabs:

| Tab | Contents |
|-----|----------|
| **General** | Title, description/logline, author name |
| **Goals** | Final word count target, daily word goal, deadline with days-remaining hint |
| **Doc Style** | View active style (locked after creation) |
| **Characters** | Quickly add multiple character documents to the Binder |
| **Places** | Quickly add multiple place/location documents to the Binder |
| **Research Type** | Academics or Pastoral Sermons *(Research projects only)* |
| **Hot-Links** | Enable/disable hot-links; manage linked character, place, and item pages |

### Goals & Status Bar

- Set a **Final Word Count** and **Daily Word Goal** in Settings → Goals
- A **status bar** at the bottom of the editor shows live progress bars for both goals while inside a project
- The status bar also shows a **deadline chip** that turns red within 7 days or when overdue

### Hot-Links

Hot-links let you insert inline reference badges while writing that open a character or place's synopsis and notes instantly.

- Tag any document as a **Character**, **Place**, or **Item** in Settings → Hot-Links
- Creating documents via the Characters or Places settings tabs **automatically registers them as hot-links**
- While writing, type `hl/` to trigger the autocomplete menu — up to 10 matches appear
- Navigate with `↑ ↓`, confirm with `Enter` or `Tab`, dismiss with `Escape`
- Click an inserted badge to open a popover showing the linked document's synopsis and notes, with an **Open Document** button
- **Name upon removal** — each hot-link has a configurable fallback text used when exporting without hot-links

### Pastoral Sermons Layout

When a Research project's type is set to Pastoral Sermons, the editor splits horizontally:

- **Top pane** — Live Bible scripture viewer
  - Translation picker: KJV, ASV, WEB, BBE, YLT, Darby *(populated from locally stored data)*
  - Cascading navigation: Testament → Book → Chapter
  - Free-text reference input for verse ranges (e.g. `Romans 8:1-8`, `Psalm 23`)
  - Verse-numbered display; scrolls to top on each new chapter
  - Drag handle to resize the split — **capped at 50% of the visible area**
- **Bottom pane** — standard writing editor, unchanged

Bible data is stored locally on the server (no external API calls at runtime). See [Bible Data Setup](#bible-data-setup).

### Export

Export the entire compiled manuscript (all documents marked "Include in Compile") as:

| Format | Notes |
|--------|-------|
| `.txt` | Plain text with chapter headings |
| `.md` | Markdown with ATX headings |
| `.docx` | Microsoft Word, Georgia 12pt |
| `.html` | Print-ready HTML — open in browser → Print → Save as PDF |
| `.json` | Full project backup including all documents and settings |

When a project contains hot-links, a modal appears at export time with the choice to keep them as plain names or replace them with each hot-link's configured fallback name.

### Scrivener Import

Import existing `.scriv` or `.scrivx` projects from Scrivener:
- Reads binder structure (folders and documents)
- Imports synopses and notes per document
- Converts RTF content to HTML
- Falls back to flat import if no XML manifest is found
- Progress bar shown during import; project list refreshes on completion

### Multi-User & Collaboration

Optional Google SSO authentication and real-time collaboration (disabled by default — see [Multi-User SSO](#multi-user-sso)):

- **Google Sign-In** — OAuth 2.0 via Passport.js; only enabled when credentials are set in the environment
- **Per-user project libraries** — each authenticated user owns their own projects
- **Project sharing** — share any project with other users as **Viewer** or **Editor**; manage collaborators from the Share modal (toolbar)
- **Real-time co-editing** — multiple users editing the same document see changes applied live via WebSocket (socket.io)
- **Collaboration presence bar** — shows avatars and names of other users currently in the same document
- **Admin panel** — manage all registered users (approve, suspend, promote, delete); accessible from the toolbar for admin accounts
- **Require approval** — optionally require an admin to approve new Google accounts before they can access ScribeFlow
- **Single-user mode preserved** — if no Google credentials are set, the app runs exactly as before with no login required

---

## Project Structure

```
scribeflow/
├── backend/
│   ├── server.js               # Express + socket.io server — routes, auth, startup scan
│   ├── package.json
│   ├── config.js               # Environment-driven configuration (SSO, session secret, etc.)
│   ├── users.js                # File-backed user store (JSON)
│   ├── data/
│   │   ├── projects/           # One JSON file per project
│   │   ├── sessions/           # Session store (file-based, auto-managed)
│   │   └── bibles/             # Bible JSON files (populated by fetcher)
│   │       ├── index.json      # Available translations list
│   │       ├── kjv.json
│   │       └── ...
│   ├── middleware/
│   │   └── auth.js             # requireAuth middleware (no-op in single-user mode)
│   ├── scripts/
│   │   └── fetch-bibles.js     # Bible data fetcher (audit + selective repair)
│   └── routes/
│       ├── projects.js         # Project CRUD API
│       ├── documents.js        # Document save/load API
│       ├── export.js           # Export endpoints
│       ├── bible.js            # Bible lookup API (served from local data)
│       ├── auth.js             # Google OAuth routes (/auth/google, /auth/logout, /auth/status)
│       ├── admin.js            # Admin API (user management, SSO toggle)
│       └── share.js            # Project sharing API
├── frontend/
│   ├── public/
│   │   └── js/
│   │       ├── app.js          # Main application JS (~2 360 lines)
│   │       └── multiuser.js    # SSO, collaboration, admin/share UI (~460 lines)
│   └── views/
│       ├── index.ejs           # Root EJS template (14 lines — assembles partials)
│       └── partials/
│           ├── head.ejs        # <head> tag with full CSS
│           ├── home-screen.ejs # Home / project list screen
│           ├── overlays.ejs    # Pending-approval, admin, share, and auth overlays
│           ├── toolbar.ejs     # Main toolbar
│           ├── app.ejs         # Editor area (binder, format bar, editor, inspector)
│           └── menus.ejs       # Modals: settings, export, context menu, hot-link UI
├── lxc/
│   ├── install.sh              # Run inside a fresh LXC container
│   └── create-lxc.sh           # Run on Proxmox host to auto-create LXC
├── download-bibles.js          # Standalone Bible downloader (run anywhere)
├── Dockerfile
├── docker-compose.yml
├── CHANGELOG.md
└── README.md
```

---

## Deployment: Docker

### Quick Start

```bash
cd scribeflow
docker compose up -d
```

Access at: `http://YOUR_SERVER_IP:3051`

### Custom port

```bash
PORT=8080 docker compose up -d
```

### Services

`docker-compose.yml` defines two services:

| Service | Purpose |
|---------|---------|
| `scribeflow` | Main application — always running |
| `bible-fetcher` | One-shot Bible data downloader — run manually after first build |

```bash
# Start the main app
docker compose up -d

# Fetch Bible data (run once — see Bible Data Setup)
docker compose run --rm bible-fetcher
```

### Data volumes

| Volume | Mount | Contents |
|--------|-------|----------|
| `scribeflow_data` | `/data` | All projects, user store, session files |
| `bible_data` | `/app/data/bibles` | Bible translation JSON files |

Both volumes persist independently of the container image. Rebuilding the image does **not** delete either volume.

---

## Deployment: Proxmox LXC

### Option A — Automated (recommended)

Run on your **Proxmox host**:

```bash
# Edit create-lxc.sh to set CTID, storage, and network settings first
chmod +x lxc/create-lxc.sh
bash lxc/create-lxc.sh
```

This downloads a Debian 12 template, creates the container, copies ScribeFlow, and configures a systemd service with auto-restart.

### Option B — Manual

```bash
# 1. Create a Debian 12 or Ubuntu 22.04 LXC container in Proxmox
# 2. Enter the container
pct enter <CTID>

# 3. Copy the ScribeFlow directory into the container, then run:
bash lxc/install.sh

# 4. Fetch Bible data (separate step — see Bible Data Setup)
node /opt/scribeflow/backend/scripts/fetch-bibles.js
```

### LXC Recommended Specs

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| Memory | 256 MB | 512 MB |
| Disk | 4 GB | 10 GB |
| CPU | 1 core | 1–2 cores |

> The extra disk allowance is for Bible JSON data (~25 MB compressed).

### Managing the LXC service

```bash
# Status and logs (from Proxmox host)
pct exec <CTID> -- systemctl status scribeflow
pct exec <CTID> -- journalctl -u scribeflow -f

# Restart
pct exec <CTID> -- systemctl restart scribeflow

# Change port
pct exec <CTID> -- bash -c "sed -i 's/PORT=3051/PORT=8080/' \
  /etc/systemd/system/scribeflow.service && \
  systemctl daemon-reload && systemctl restart scribeflow"
```

---

## Bible Data Setup

ScribeFlow includes a built-in Bible scripture viewer for **Pastoral Sermons** projects. All data is stored locally — no internet connection is required at runtime.

### Translations included

| ID | Label | Translation |
|----|-------|-------------|
| `kjv` | KJV | King James Version (1769) |
| `asv` | ASV | American Standard Version (1901) |
| `web` | WEB | World English Bible (modern, public domain) |
| `bbe` | BBE | Bible in Basic English (1949/1964) |
| `ylt` | YLT | Young's Literal Translation (1898) |
| `darby` | Darby | Darby Translation (1890) |

All translations are public domain. Source: [bible-api.com](https://bible-api.com) (Tim Morgan, open source).

### Fetching Bible data — Docker

```bash
# Start ScribeFlow first
docker compose up -d

# Then run the fetcher (one-off container — exits when complete)
docker compose run --rm bible-fetcher
```

Estimated time: 10–20 minutes. Downloads ~25 MB total. The fetcher writes to the `bible_data` volume which the main container also mounts — no restart needed.

### Fetching Bible data — LXC

```bash
node /opt/scribeflow/backend/scripts/fetch-bibles.js
```

### Fetching Bible data — standalone (any machine with Node.js)

```bash
# Run download-bibles.js from the scribeflow root directory
node download-bibles.js

# Then copy the output folder into the container
docker cp bibles/ scribeflow:/app/data/bibles/
# or for LXC:
cp -r bibles/ /opt/scribeflow/backend/data/bibles/
```

### How the fetcher works

On every run the fetcher performs a full **audit before downloading anything**:

1. Reads each translation file on disk and checks all 1,189 chapters
2. Flags any chapter that is missing, empty (`[]`), or has zero verses
3. Fetches **only the flagged chapters** — complete data is never re-downloaded
4. Patches the file in-place and rewrites `index.json`

If a chapter fails after 5 retries with exponential back-off, it is stored as `[]` and picked up automatically on the next run. Re-run the fetcher as many times as needed until all gaps are filled.

```
  Auditing existing files...

  ✓  KJV     complete  (4.5 MB)
  ✗  ASV     23 chapter(s) missing or empty
  ✗  WEB     not downloaded yet

  23 total gap(s) across 2 translation(s). Starting fetch...
```

### If Bible data is not present

ScribeFlow starts normally without Bible data. The Scripture pane displays:

> *Bible data not yet downloaded. Run: `node backend/scripts/fetch-bibles.js`*

---

## Multi-User SSO

By default ScribeFlow runs in **single-user mode** — no login, no credentials required. Multi-user mode is enabled by setting Google OAuth environment variables.

### Prerequisites

1. Create a Google Cloud project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable the **Google+ API** (or **Google Identity**)
3. Create an **OAuth 2.0 Client ID** (Web application type)
4. Set the authorised redirect URI to `https://your-domain/auth/google/callback`

### Docker — enabling SSO

Add the following to `docker-compose.yml` under the `scribeflow` service's `environment:` block:

```yaml
environment:
  GOOGLE_CLIENT_ID: your-client-id.apps.googleusercontent.com
  GOOGLE_CLIENT_SECRET: your-client-secret
  GOOGLE_CALLBACK_URL: https://your-domain/auth/google/callback
  SESSION_SECRET: a-long-random-string
```

Rebuild and restart:

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

The first Google account to sign in automatically becomes the **Administrator**.

### LXC — enabling SSO

Edit the systemd service file (`/etc/systemd/system/scribeflow.service`) to add the same four environment variables under `[Service]`, then:

```bash
systemctl daemon-reload
systemctl restart scribeflow
```

### Admin panel

Accessible from the toolbar (👥 icon, visible to all users when SSO is on). Admins see an additional **Users** tab for:
- Approving or denying pending accounts
- Suspending or reactivating active users
- Promoting users to admin

**Require approval**: in the Admin panel → Multi-User tab, toggle **Require admin approval for new users** to prevent automatic access for all Google accounts.

### Disabling SSO

In the Admin panel → Multi-User tab → Danger Zone → **Disable SSO & Return to Single-User**. All project data and user records are preserved.

---

## Updating ScribeFlow

### How data persistence works

| Storage | Location | Survives rebuild? |
|---------|----------|-------------------|
| Projects | `scribeflow_data` volume → `/data/projects` | ✓ Yes |
| Bible data | `bible_data` volume → `/app/data/bibles` | ✓ Yes |
| Sessions | `scribeflow_data` volume → `/data/sessions` | ✓ Yes |
| LXC projects | `/var/lib/scribeflow` | ✓ Yes |

### Docker update workflow

```bash
# 1. Stop the container (volumes untouched)
docker compose down

# 2. Rebuild the image
docker compose build --no-cache

# 3. Start — existing projects reload automatically
docker compose up -d

# 4. Verify startup log
docker compose logs scribeflow | head -40
```

Expected startup output:
```
────────────────────────────────────────────────────────────
  ScribeFlow  v2.3
────────────────────────────────────────────────────────────
  Port           : 3051
  Data directory : /data
  Auth           : single-user (no login)
  Projects found : 3
────────────────────────────────────────────────────────────
  [OK]       "My Novel" — 24 doc(s), 42,301 words
  [OK]       "Sunday Series" — 12 doc(s), 8,740 words
  [OK]       "Research Notes" — 5 doc(s), 3,200 words
────────────────────────────────────────────────────────────
  Loaded: 3  |  Repaired: 0  |  Corrupt: 0
  Bible data     : 6 translation(s) ready
────────────────────────────────────────────────────────────
  Listening on http://0.0.0.0:3051
```

> Bible data is in the `bible_data` volume — no need to re-fetch after a rebuild.

### LXC update workflow

```bash
# Push new files from Proxmox host (replace 200 with your CTID)
pct push 200 /path/to/scribeflow /tmp/scribeflow --recursive

# Run install script — preserves existing project data
pct exec 200 -- bash /tmp/scribeflow/lxc/install.sh

# Verify
pct exec 200 -- journalctl -u scribeflow -n 30
```

### After updating from v2.1 or earlier

The backend now uses `better-sqlite3` (native module) and `bcryptjs`. After pulling the update run:

```bash
cd backend && npm install   # installs the new 'ejs' dependency
```

No data migration is needed — all project files remain unchanged.

### Backup before updating

**Docker:**
```bash
docker run --rm \
  -v scribeflow_scribeflow_data:/data \
  -v $(pwd):/backup \
  alpine tar -czf /backup/scribeflow-backup-$(date +%Y%m%d).tar.gz /data
```

**LXC:**
```bash
pct exec 200 -- tar -czf /tmp/scribeflow-backup.tar.gz /var/lib/scribeflow
pct pull 200 /tmp/scribeflow-backup.tar.gz ./scribeflow-backup.tar.gz
```

### Startup integrity scan

On every launch the server scans all project files and auto-repairs common issues: missing fields, absent binder structure, word counts of zero. If a JSON file is completely unreadable a `.bak` copy is saved and the file is skipped — restore it manually or from a volume backup.

---

## API Reference

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/me` | Current auth state and user object (always available) |
| GET | `/auth/google` | Initiate Google OAuth sign-in |
| GET | `/auth/google/callback` | OAuth callback (handled automatically) |
| GET | `/auth/logout` | Sign out and destroy session |
| GET | `/auth/status` | SSO enabled flag and current user |

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List projects visible to the current user |
| POST | `/api/projects` | Create project |
| GET | `/api/projects/:id` | Get full project (binder + all documents + settings) |
| PUT | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project |
| GET | `/api/projects/:id/share` | Get sharing info (owner, collaborators) |
| PUT | `/api/projects/:id/share` | Add or update a collaborator |
| DELETE | `/api/projects/:id/share/:userId` | Remove a collaborator |
| POST | `/api/projects/:id/share/transfer` | Transfer ownership to another user |

### Documents

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/documents/:projectId/:docId` | Get document |
| PUT | `/api/documents/:projectId/:docId` | Save document (auto-calculates word count) |
| POST | `/api/documents/:projectId` | Create document |
| DELETE | `/api/documents/:projectId/:docId` | Delete document |

### Export

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/export/:projectId/txt` | Plain text |
| GET | `/api/export/:projectId/md` | Markdown |
| GET | `/api/export/:projectId/docx` | Word document |
| GET | `/api/export/:projectId/html` | Print-ready HTML |
| GET | `/api/export/:projectId/json` | Full JSON backup |

Add `?removeHotlinks=1` to any export URL to replace hot-link widgets with each link's fallback name.

### Bible

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/bible/translations` | List available translations |
| GET | `/api/bible/books` | List all 66 canonical books |
| GET | `/api/bible/search?q=John+3:16&trans=kjv` | Free-text reference lookup with verse range support |
| GET | `/api/bible/:trans/:book/:chapter` | Fetch a full chapter directly |

### Admin *(admin users only)*

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/status` | SSO status, credential check, current user's role |
| POST | `/api/admin/enable-sso` | Enable multi-user SSO |
| POST | `/api/admin/disable-sso` | Disable SSO, return to single-user mode |
| PUT | `/api/admin/config` | Update admin config (e.g. `requireApproval`) |
| GET | `/api/admin/users` | List all registered users |
| POST | `/api/admin/users/:id/approve` | Approve a pending user |
| POST | `/api/admin/users/:id/suspend` | Suspend an active user |
| POST | `/api/admin/users/:id/reactivate` | Reactivate a suspended user |
| DELETE | `/api/admin/users/:id` | Permanently delete a user |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server status, version, project count, SSO state |

---

## Data Storage

```
/data/
  projects/
    <uuid>.json    # One file per project — binder, all documents, settings
  sessions/
    <session>.json # Session files (auto-managed, TTL 30 days)
  users.json       # Registered user store (only present when SSO has been used)
  config.json      # App config (ssoEnabled, requireApproval)

/app/data/bibles/
  index.json       # Available translations
  kjv.json         # ~4.5 MB each
  asv.json
  web.json
  bbe.json
  ylt.json
  darby.json
```

For production use, mount `/data` on a NAS or ZFS dataset to enable snapshots and off-site backups.

---

## Reverse Proxy (optional)

**Caddy:**
```
scribeflow.yourdomain.com {
    reverse_proxy localhost:3051
}
```

**Nginx:**
```nginx
server {
    listen 80;
    server_name scribeflow.yourdomain.com;
    location / {
        proxy_pass http://localhost:3051;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

> The `Upgrade`/`Connection` headers are required for WebSocket (socket.io real-time collaboration) to work through Nginx.

---

## Version History

| Version | Summary |
|---------|---------|
| **2.3** | Scripture pane overflow fix; daily word goal now counts pre-goal writing correctly |
| **2.2** | Remove Google SSO; local username/password auth; SQLite database for projects + users |
| **2.1** | Frontend split — EJS templates + static JS files |
| **2.0** | Project Settings modal regression fix |
| **1.9** | Bible fetcher 404/429 handling; SSO/settings bug fixes |
| **1.8** | Real-time collaboration (socket.io), project sharing, admin panel |
| **1.7** | Google SSO authentication (optional, single-user default preserved) |
| **1.6** | Bible fetcher parameterized API — no spaces in URLs |
| **1.5** | Bible fetcher Cloudflare header fix |
| **1.4** | Bible fetcher switched to bible-api.com |
| **1.3** | Bible fetcher self-probing CDN slug detection (superseded by 1.4) |
| **1.2** | Bible fetcher 403 fix — revert %20 encoding |
| **1.1** | Hot-link fallback names + export replacement; book name encoding fix |
| **1.0** | Project type labels on home screen |
| **0.9** | Bible fetcher audit + selective chapter repair |
| **0.8** | Bible fetch as separate post-install step; `bible_data` volume |
| **0.7** | Bible pane dropdown navigation (Testament → Book → Chapter); 50% resize cap |
| **0.6** | Offline Bible library — all 6 translations bundled locally, no external API |
| **0.5** | Research/Pastoral Sermons layout, Bible scripture pane, version tracking |
| **0.4** | Document Style templates, Characters/Places quick-add, status bar goals |
| **0.3** | Project Settings modal, Hot-Links system, writing goals |
| **0.2** | Scrivener import, centered home screen, cross-browser fixes |
| **0.1** | Initial release — editor, binder, inspector, corkboard, export |

See [CHANGELOG.md](CHANGELOG.md) for full details on each version.

# ScribeFlow — Self-Hosted Writing Workspace

A Scrivener-inspired web application for writers, designed to run on your own server via Proxmox LXC or Docker.

---

## Features

- **Binder** — Hierarchical project tree with folders and documents
- **Rich Text Editor** — Full formatting toolbar (bold, italic, headings, lists, blockquotes, etc.)
- **Inspector Panel** — Synopsis, notes, labels, status, and compile flags per document
- **Corkboard View** — Index card overview of all scenes/chapters
- **Auto-Save** — Saves to the server automatically as you type (1.5s debounce)
- **Word Count & Statistics** — Live word count, reading time, progress toward targets
- **Dark Mode** — Toggle between light and dark themes
- **Focus/Distraction-Free Mode** — Hides all UI chrome for immersive writing
- **Export** — Export your manuscript as:
  - `.txt` Plain Text
  - `.md` Markdown
  - `.docx` Microsoft Word
  - `.html` HTML (open in browser → Print → Save as PDF)
  - `.json` Full project backup

---

## Project Structure

```
scribeflow/
├── backend/
│   ├── server.js           # Express server entry point
│   ├── package.json
│   └── routes/
│       ├── projects.js     # Project CRUD API
│       ├── documents.js    # Document save/load API
│       └── export.js       # Export endpoints
├── frontend/
│   └── public/
│       └── index.html      # Full single-file frontend
├── lxc/
│   ├── install.sh          # Run inside a fresh LXC container
│   └── create-lxc.sh       # Run on Proxmox host to auto-create LXC
├── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## Deployment: Docker

### Quick Start

```bash
# Clone / copy the scribeflow directory, then:
cd scribeflow
docker compose up -d
```

Access at: `http://YOUR_SERVER_IP:3000`

### Custom port

```bash
PORT=8080 docker compose up -d
```

### Data persistence

Data is stored in a Docker volume `scribeflow_data`. To back up:

```bash
docker run --rm -v scribeflow_data:/data -v $(pwd):/backup \
  alpine tar -czf /backup/scribeflow-backup.tar.gz /data
```

---

## Deployment: Proxmox LXC

### Option A — Automated (recommended)

Run on your **Proxmox host**:

```bash
# Edit create-lxc.sh to set your CTID, storage, and network settings first
chmod +x lxc/create-lxc.sh
bash lxc/create-lxc.sh
```

This will:
1. Download a Debian 12 LXC template (if needed)
2. Create and start the container
3. Copy ScribeFlow files and run the installer
4. Configure a systemd service with auto-restart

### Option B — Manual

1. Create a Debian 12 or Ubuntu 22.04 LXC container in Proxmox
2. Enter the container: `pct enter <CTID>`
3. Copy the ScribeFlow directory into the container
4. Run: `bash lxc/install.sh`

### LXC Recommended Specs

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| Memory   | 256 MB  | 512 MB      |
| Disk     | 2 GB    | 8 GB        |
| CPU      | 1 core  | 1–2 cores   |

### Managing the LXC service

```bash
# From Proxmox host:
pct exec <CTID> -- systemctl status scribeflow
pct exec <CTID> -- systemctl restart scribeflow
pct exec <CTID> -- journalctl -u scribeflow -f

# Change port:
pct exec <CTID> -- bash -c "sed -i 's/PORT=3051/PORT=8080/' /etc/systemd/system/scribeflow.service && systemctl daemon-reload && systemctl restart scribeflow"
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List all projects |
| POST | `/api/projects` | Create project |
| GET | `/api/projects/:id` | Get project (full data) |
| PUT | `/api/projects/:id` | Update project (binder, settings) |
| DELETE | `/api/projects/:id` | Delete project |
| GET | `/api/documents/:projectId/:docId` | Get document |
| PUT | `/api/documents/:projectId/:docId` | Save document |
| POST | `/api/documents/:projectId` | Create document |
| DELETE | `/api/documents/:projectId/:docId` | Delete document |
| GET | `/api/export/:projectId/txt` | Export as plain text |
| GET | `/api/export/:projectId/md` | Export as Markdown |
| GET | `/api/export/:projectId/docx` | Export as Word (.docx) |
| GET | `/api/export/:projectId/html` | Export as HTML |
| GET | `/api/export/:projectId/json` | Export as JSON backup |

---

## Data Storage

All data is stored as JSON files:

```
/data/projects/
  <uuid>.json    # One file per project, contains full binder + all documents
```

For production use, consider mounting `/data` on a NAS or ZFS dataset for snapshots.

---

## Reverse Proxy (optional)

To expose ScribeFlow on a domain with HTTPS, add to your Nginx/Caddy config:

**Caddy:**
```
scribeflow.yourdomain.com {
    reverse_proxy localhost:3000
}
```

**Nginx:**
```nginx
server {
    listen 80;
    server_name scribeflow.yourdomain.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## Updating ScribeFlow (preserving all project data)

### How data persistence works

Projects are stored as JSON files in a **volume that exists independently of the container image**:

- **Docker**: Named volume `scribeflow_data` → mounted at `/data` inside the container
- **LXC**: Directory `/var/lib/scribeflow` on the host filesystem

Stopping, removing, or rebuilding the container/image **never touches the volume**. Your projects survive every update.

### Docker update workflow

```bash
# 1. Stop and remove the running container (data volume is untouched)
docker compose down

# 2. Rebuild the image with the latest code
docker compose build --no-cache

# 3. Start the new container — startup scan auto-detects existing projects
docker compose up -d

# 4. Confirm projects were found (check the startup logs)
docker compose logs scribeflow | head -30
```

Expected startup output:
```
────────────────────────────────────────────────────
  ScribeFlow  v1.0.0
────────────────────────────────────────────────────
  Port           : 3051
  Data directory : /data
  Projects found : 3
────────────────────────────────────────────────────
  [OK]       "My Novel" — 24 doc(s), 42,301 words
  [OK]       "Short Stories" — 8 doc(s), 9,150 words
  [OK]       "Research Notes" — 5 doc(s), 3,200 words
────────────────────────────────────────────────────
  Loaded: 3  |  Repaired: 0  |  Skipped (corrupt): 0
  Listening on http://0.0.0.0:3051
```

### LXC update workflow

```bash
# Copy the new ScribeFlow files into the container
# (from Proxmox host — replace 200 with your CTID)
pct push 200 /path/to/scribeflow /tmp/scribeflow --recursive

# Run the install script — it detects existing data and preserves it
pct exec 200 -- bash /tmp/scribeflow/lxc/install.sh

# Check logs after update
pct exec 200 -- journalctl -u scribeflow -n 30
```

### Backup before updating (recommended)

**Docker:**
```bash
docker run --rm \
  -v scribeflow_data:/data \
  -v $(pwd):/backup \
  alpine tar -czf /backup/scribeflow-backup-$(date +%Y%m%d).tar.gz /data
```

**LXC:**
```bash
pct exec 200 -- tar -czf /tmp/scribeflow-backup.tar.gz /var/lib/scribeflow
pct pull 200 /tmp/scribeflow-backup.tar.gz ./scribeflow-backup.tar.gz
```

### What happens if a project file is corrupt?

On startup, each project file is validated. If a file has structural issues (missing fields, bad word counts), it is automatically repaired in-place. If JSON is completely unparseable, a `.bak` copy is saved and the file is skipped — you can restore from the backup manually or from a volume backup.

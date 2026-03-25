# ScribeFlow Changelog

All notable changes are documented here. Version increments by tenths.

---

## Version 2.3

### Bug Fixes

**Scripture pane overflow on initial load (Pastoral Sermons)**
- When a large chapter was loaded for the first time, the scripture pane would expand to fill the entire viewport and could not be resized or scrolled.
- Added `max-height: 50%` CSS rule to `#editor-wrap.sermon-split #scripture-pane` so the cap is enforced before any drag interaction.
- Added `clampScripturePane()` JS call inside `renderScriptureContent()` as a safety net to enforce the cap immediately after content is injected into the DOM.

**Goals tab — pre-existing words not counted in daily percentage**
- Words written before a daily word goal was created and saved were not reflected in the daily progress percentage.
- Root cause: the daily word log (`dailyLog`) was updated in memory on each document save but was only persisted to the server when project settings were explicitly saved. If the page was reloaded before goals were set, that day's writing was lost from the log.
- Fixed by firing a background project settings save immediately after `dailyLog` is updated in the `saveCurrentDoc` wrapper. Daily word progress is now always persisted to the server as writing occurs, independent of the settings save.

---

## Version 2.2

### Rewrite — Auth, Database, and Multi-User

**Remove Google SSO; replace with local username/password accounts**
- Google OAuth 2.0 and Passport.js removed entirely. No external auth dependency.
- Multi-user mode is now enabled by uncommenting `AUTH_ENABLED=true` in `docker-compose.yml` and rebuilding — no runtime toggle required.
- Login is a simple username/password form served by ScribeFlow itself.
- On first start with `AUTH_ENABLED=true`, an admin account is created automatically from the `ADMIN_USERNAME` / `ADMIN_PASSWORD` environment variables (default: `admin` / `admin` — change immediately).

**SQLite database via `better-sqlite3`**
- All project data previously stored as individual JSON files in `data/projects/` is now stored in a single SQLite database (`data/scribeflow.db`).
- User accounts are also stored in the same SQLite database (replacing per-user JSON files in `data/users/`).
- On first start, existing JSON project files are automatically migrated into the database; legacy files are left in place as backups.
- Synchronous SQLite API eliminates all async file-IO in project routes.

**Admin panel — User Management**
- Admins create user accounts directly in App Settings → Users.
- No self-registration flow; all accounts are admin-created.
- Actions: Create, Suspend, Reactivate, Delete.
- Password reset available via `PUT /api/admin/users/:id/password`.

**Frontend**
- Login overlay replaced with a clean username/password form (no Google branding).
- Presence bar uses initials instead of Google profile photos.
- Admin button is hidden in single-user mode; visible to admins only in multi-user mode.
- `multiuser.js` cleaned of all SSO-specific code; 230 lines removed.

**Backend packages removed**: `passport`, `passport-google-oauth20`
**Backend packages added**: `better-sqlite3`, `bcryptjs`
**Dockerfile**: added `python3 make g++` (Alpine build tools for native SQLite module)

**Settings modal fix**
- Root cause identified: the `#admin-overlay` added in v1.7 used `display:none` but `opacity:0` without a fallback, causing it to intercept pointer events in certain browser states even when visually hidden. Fixed by ensuring all overlay show/hide paths use only `display` toggling consistently.

---

## Version 2.1

### Refactor

**Frontend split — EJS templates + static JS files**
- `frontend/public/index.html` (~4 400 lines) was a single monolithic file combining all CSS, HTML, and JavaScript. Split into discrete, independently maintainable files.
- **Option A — Static JS** (`frontend/public/js/`):
  - `app.js` — main application logic (2 362 lines); previously the first `<script>` block
  - `multiuser.js` — SSO, collaboration, socket.io, admin/share UI (462 lines); previously the second `<script>` block
  - Both files served directly by `express.static`; no bundler required
- **Option B — EJS templates** (`frontend/views/`):
  - `index.ejs` — 14-line root template that assembles all partials
  - `partials/head.ejs` — `<head>` with full CSS (934 lines)
  - `partials/home-screen.ejs` — home/project-list screen
  - `partials/overlays.ejs` — pending-approval, admin, share, and auth overlays
  - `partials/toolbar.ejs` — main toolbar
  - `partials/app.ejs` — editor area (binder, format bar, editor, inspector, status bar)
  - `partials/menus.ejs` — export menu, context menu, settings modal, hot-link dropdown/popover, export-HL modal
- **Backend**:
  - `ejs` added to `backend/package.json` dependencies
  - `server.js`: EJS view engine configured (`app.set('view engine', 'ejs')` + views path); SPA fallback changed from `res.sendFile` to `res.render('index')`
  - Run `npm install` inside `backend/` after updating to install EJS


## Version 2.0

### Bug Fix

**Project Settings modal — regression fix**
- The Settings modal had stopped appearing after the multi-user additions in v1.7–1.8
- Stripped all CSS opacity/transition animation from `#settings-overlay` which had been left in a non-visible state
- Restructured `openSettings()` to set `display: flex` at the very first line before any data-population code, so a JS error in field-filling cannot prevent the overlay from showing
- Simplified `closeSettings()` to set `display: none` directly with no animation delay
- `closeSettings()` also explicitly sets `settingsOpen = false` to keep internal state consistent


## Version 1.9

### Bug Fix

**Bible fetcher — 404 handling and rate-limit retry**
- Improved handling of HTTP 404 responses from bible-api.com when a chapter reference is not found in the parameterized API; these are now logged and skipped rather than stored as empty arrays that trigger infinite re-fetch loops
- Added exponential-backoff retry logic specifically for HTTP 429 (Too Many Requests) responses; the fetcher pauses and retries up to 5 times before marking a chapter as failed

**SSO / Settings — miscellaneous fixes**
- Corrected the Admin Panel button wiring so it reliably opens the admin overlay
- Fixed tab-switching logic in the Settings modal that could leave multiple sections active simultaneously
- Corrected `openSettings._pendingTab` flow so the correct tab is highlighted on open


## Version 1.8

### New Features

**Multi-user collaboration — real-time editing with socket.io**
- Multiple users editing the same document now see each other's changes in real time via WebSocket (socket.io)
- Users are placed in per-document rooms; joining and leaving is handled automatically on document open/close and project navigation
- `selectDoc`, `showHome`, and `openProject` are wrapped in the second script block to call socket join/leave at the right lifecycle points

**Project sharing**
- New **Share** button (toolbar, hidden unless SSO is enabled) opens a share modal
- Project owner can invite other registered users by email with **Viewer** or **Editor** role
- Shared-with list shows all current collaborators with their roles; owner can revoke access at any time
- Backend: new `routes/share.js` with `POST /:id/share` and `DELETE /:id/share/:userId` endpoints; access-control helpers updated across all routes

**Admin panel**
- New admin overlay (gear icon, visible to admin users only) for managing registered users
- Lists all users with their provider, email, and admin status
- Admin can promote/demote other users and delete accounts
- Backend: new `routes/admin.js` with full CRUD on the user store; protected by admin-only middleware

**User management backend**
- New `backend/users.js` — file-backed user store (JSON) with helpers for create, find, list, update, delete
- New `backend/config.js` — centralises environment-driven configuration (SSO credentials, session secret, data directory, admin email)


## Version 1.7

### New Features

**Google SSO authentication**
- Optional Google OAuth 2.0 sign-in via Passport.js (`passport-google-oauth20`)
- Disabled by default; enabled by setting `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `SESSION_SECRET` environment variables (or Docker secrets)
- When enabled: unauthenticated requests to the API redirect to `/auth/google`; the frontend shows an auth overlay for sign-in
- When disabled: application runs in single-user mode with no login required (all existing behaviour preserved)
- New `backend/middleware/auth.js` — attaches `req.userId` / `req.isAdmin` from session; short-circuits to `next()` when SSO is off
- New `backend/routes/auth.js` — `/auth/google`, `/auth/google/callback`, `/auth/logout`, `/auth/status` endpoints
- `docker-compose.yml` updated with optional SSO environment variable stubs
- Frontend: auth overlay with "Sign in with Google" button; pending-approval screen for accounts awaiting admin activation
- Session persistence via `session-file-store` (survives server restarts)


## Version 1.6

### Bug Fix

**Bible fetcher — switched to parameterized API, eliminating all space encoding issues**
- Previous versions using natural-language references (`/1%20Samuel%201?translation=kjv`) caused HTTP 403 errors for any book whose display name contains spaces. The server was rejecting `%20`-encoded spaces in the URL path regardless of headers.
- Switched to bible-api.com's **parameterized API** which uses 3-letter uppercase book IDs with no spaces anywhere in the URL:
  - `https://bible-api.com/data/{translation}/books/{BOOK_ID}/chapters/{n}/verses.json`
  - Examples: `.../books/1SA/...`, `.../books/SNG/...`, `.../books/1CO/...`
- Added complete `BOOK_IDS` map for all 66 canonical books (GEN, EXO, ..., 1SA, SNG, 1CO, ..., REV)
- Switched from `http.get()` to `http.request()` for more explicit control over the request lifecycle
- Fix applied to both `backend/scripts/fetch-bibles.js` and `download-bibles.js`


## Version 1.5

### Bug Fix

**Bible fetcher — Cloudflare blocking bare Node.js requests**
- bible-api.com sits behind Cloudflare which returns HTTP 403 for requests that identify as `node` (Node.js's default User-Agent). This affected all books, not just numbered ones — the earlier tests only appeared to work on some books because those were already cached on disk.
- Added browser-like HTTP headers to every request in `httpGet()`:
  - `User-Agent: Mozilla/5.0 (compatible; ScribeFlow-BibleFetcher/1.5)`
  - `Accept: application/json, text/plain, */*`
  - `Accept-Language: en-US,en;q=0.9`
  - `Accept-Encoding: gzip, deflate, br`
  - `Cache-Control: no-cache`
- Added transparent gzip/deflate/brotli decompression so compressed responses are handled correctly now that `Accept-Encoding` is advertised.
- Fix applied to both `backend/scripts/fetch-bibles.js` and `download-bibles.js`.


## Version 1.4

### Bug Fix

**Bible fetcher — switched from wldeh CDN to bible-api.com**
- Multiple versions attempted to work around HTTP 403 errors from the jsDelivr CDN (wldeh/bible-api) for books with numbered or multi-word names. The CDN's actual folder naming convention cannot be verified without network access and all variants tried produced 403s.
- Switched the data source to **bible-api.com** which accepts natural-language chapter references (`1 Samuel 1`, `Song of Solomon 3`, `1 Corinthians 13`) as URL query parameters instead of file paths. This completely eliminates path-naming issues — the book display name is percent-encoded as a query string value, not a path segment.
- Translation IDs updated to match bible-api.com convention (`kjv`, `asv`, `web`, `bbe`, `ylt`, `darby` instead of `en-kjv`, `en-asv`, etc.)
- Added polite 150ms delay between requests (bible-api.com is a small open-source service)
- Fix applied to both `backend/scripts/fetch-bibles.js` and `download-bibles.js`
- All previously failed chapters stored as empty `[]` will be repaired on the next run


## Version 1.3

### Bug Fix

**Bible fetcher — 403 on numbered and multi-word books (self-probing fix)**
- The CDN's actual folder naming for books like "1 Samuel", "Song of Solomon", "1 Corinthians" is unknown without network access, and has caused persistent 403 errors across multiple fix attempts.
- Replaced all hardcoded slug assumptions with a self-probing mechanism: on first encounter of each book, the fetcher silently tries up to 4 URL variants in order until one returns HTTP 200, then caches that working format for all remaining chapters of the same book.
- Variants tried (in order): `1-samuel`, `1samuel`, `first-samuel`, `firstsamuel`; for Song of Solomon: `song-of-solomon`, `songofsolomon`; single-word books like `genesis` or `matthew` are tried as-is with no probing overhead.
- The cache is per translation per book, so each translation only probes once per ambiguous book.
- The working slug is logged when it differs from the original: `[PROBE] 1 Samuel: CDN uses "1samuel" (not "1-samuel")`
- Fix applied to both `backend/scripts/fetch-bibles.js` and `download-bibles.js`.
- Re-running the fetcher will probe and fill all previously-failed chapters automatically.


## Version 1.2

### Bug Fix

**Bible fetcher — 403 error on multi-word book names**
- v1.1 introduced `CDN_BOOK_SLUGS` and `cdnBookPath()` which converted hyphens to spaces and percent-encoded them (e.g. `1-samuel` → `1%20samuel`). jsDelivr returns HTTP 403 for paths containing `%20` as a CDN policy block.
- The CDN file paths in the wldeh/bible-api repository use the **same hyphen-separated slugs** as our internal `BOOKS` array (`song-of-solomon`, `1-samuel`, `1-corinthians`, etc.). Hyphens are valid URL path characters and require no encoding or conversion.
- Removed `CDN_BOOK_SLUGS`, `cdnBookPath()`, and all `encodeURIComponent` calls from both `backend/scripts/fetch-bibles.js` and `download-bibles.js`. The URL is now built with the slug directly, identical to how single-word books were always handled.
- Re-running the fetcher will repair all chapters that previously 403'd and were stored as empty `[]`.


## Version 1.1

### Bug Fixes

**Bible fetcher — book name encoding**
- Books whose names contain spaces or numbers (1 Samuel, Song of Solomon, 1 Corinthians, etc.) were being requested with hyphens in the CDN URL path, which the CDN does not recognise
- Added `CDN_BOOK_SLUGS` map and `cdnBookPath()` helper that converts internal storage slugs (hyphen-separated) to the space-separated names the CDN expects, then percent-encodes them
- All 22 affected books now resolve correctly: 1 Samuel, 2 Samuel, 1 Kings, 2 Kings, 1 Chronicles, 2 Chronicles, Song of Solomon, 1 Corinthians, 2 Corinthians, 1 Thessalonians, 2 Thessalonians, 1 Timothy, 2 Timothy, 1 Peter, 2 Peter, 1 John, 2 John, 3 John
- A fallback converts any unmapped slug by replacing hyphens with spaces, future-proofing against any additional books
- Fix applied to both `backend/scripts/fetch-bibles.js` and the standalone `download-bibles.js`
- Re-running the fetcher will now correctly fill in any chapters from these books that previously failed and were stored as empty arrays


## Version 1.1

### New Features

**Hot-links — "Name upon removal" field**
- Each hot-link entry now has a **Name upon removal** text field
- When adding a hot-link manually, type the fallback text in the new input next to the Add button (e.g. add "Matthew Triton" → fallback "Matt")
- When characters/places are created from the Characters/Places settings tabs, the fallback defaults to the full name and can be edited in the Hot-Links tab afterwards
- In the Hot-Links list each row shows an inline editable fallback field — changes save automatically on blur

**Export — hot-link replacement option**
- When exporting (.txt, .md, .docx, .html) a project that contains hot-links, a modal appears with two choices:
  - **Keep hot-links as plain text** — widget markup is stripped, the full name is used (e.g. "Matthew Triton")
  - **Replace with fallback names** — each hot-link is replaced with its configured fallback (e.g. "Matt"), falling back to the full name if none was set
- JSON backup export always preserves hot-links as-is
- Projects with no hot-link widgets in the content skip the modal and export directly


## Version 1.0

### Changes

**Home screen — project type labels**
- Each project card now shows the Document Style and Research Sub-type (if set) next to the project title
- Displayed in a smaller, lighter monospace font so it's readable without competing with the title
- Examples: `Novel`, `Screenplay`, `Research · Academics`, `Research · Pastoral Sermons`
- Projects with no style set (created before v0.5) show no label — nothing breaks
- Backend `/api/projects` list now returns `docStyle` and `researchType` from each project's settings


## Version 0.9

### Changes

**Bible fetcher — audit and selective repair**
- On every run the fetcher now performs a full integrity audit before downloading anything
- For each translation it checks every one of its 1,189 chapters against the canonical count
- Three conditions trigger a re-fetch for a specific chapter: the chapter key is missing, the chapter was stored as an empty array `[]` from a previous failed fetch, or the chapter has zero verses
- Only the specific chapters with gaps are re-downloaded — complete chapters are never touched
- Gaps are displayed as compact chapter ranges (e.g. `Psalms  ch. 12-14, 87, 102`) before fetching begins
- If any chapters still fail after 5 retries with exponential backoff, they remain as `[]` so the next run picks them up automatically
- Translations where every chapter is already complete are reported and skipped immediately
- If all 6 translations are complete the script exits immediately with "Nothing to fetch"
- `index.json` is rewritten at the end of every run to reflect current state


## Version 0.8

### Changes

**Bible data — separate post-install step**
- Bible translations are no longer downloaded at Docker image build time
- A dedicated `bible-fetcher` service in `docker-compose.yml` handles the download on demand
- `bible_data` is now a named Docker volume shared between `scribeflow` (reads) and `bible-fetcher` (writes), so data survives image rebuilds without re-fetching

**Docker workflow:**
```
docker compose up -d                   # start ScribeFlow normally
docker compose run --rm bible-fetcher  # fetch Bible data (run once)
```

**LXC workflow:**
```
bash lxc/install.sh                               # install/update ScribeFlow
node /opt/scribeflow/backend/scripts/fetch-bibles.js  # fetch Bible data separately
```

- Both methods are safe to re-run — translations already present are skipped
- ScribeFlow starts and runs normally without Bible data; the Scripture pane shows a prompt until data is available
- To force a full re-fetch: remove the `bible_data` volume (`docker volume rm <project>_bible_data`) then re-run the fetcher


## Version 0.7

### Changes

**Bible pane — dropdown navigation**
- Added **Testament** selector (Old Testament / New Testament)
- Selecting a testament populates a **Book** dropdown with all books in that testament
- Selecting a book populates a **Chapter** dropdown and auto-loads Chapter 1
- Selecting a chapter immediately loads and displays the full chapter text, scrolled to top
- Free-text reference input is retained as a secondary option (e.g. `Romans 8:1-8` for verse ranges)
- Looking up a reference via free-text now syncs all three dropdowns to match
- Version picker still present and switching translations reloads the current chapter

**Pane resize — 50% cap**
- The scripture/editor split handle can no longer be dragged past 50% of the visible editor area
- Minimum pane height remains 120px
- Cap is calculated dynamically from the current window size


## Version 0.6

### New Features

**Offline Bible — complete internal library**
- All 6 public-domain translations are now stored inside the application itself
- No external API calls, no internet required at runtime — the Scripture pane works fully offline
- Translations included: KJV, ASV, WEB, BBE, YLT, Darby (~25 MB total, baked into the Docker image)
- New `backend/scripts/fetch-bibles.js` script downloads all translations at Docker build time
- Translation list in the version picker is loaded dynamically from `/api/bible/translations`
- New Express route `/api/bible` serves all lookups locally:
  - `GET /api/bible/translations` — list available translations
  - `GET /api/bible/search?q=John+3:16&trans=kjv` — free-text reference lookup
  - `GET /api/bible/:trans/:book/:chapter` — direct chapter fetch
- Reference parser handles abbreviated book names (Jn, Rom, Ps, Gen, Rev, etc.) and verse ranges
- If Bible data isn't present, the pane shows a clear message with the command to fetch it

**LXC deployment**
- `lxc/install.sh` now runs the Bible data fetch automatically on first install
- Skips re-downloading if translations are already present


## Version 0.5 — Current Release

### New Features

**Document Style — Research template**
- Added a "Research" document style (🔬) to the style picker on new project creation
- Research projects get folders: Topics, Sources, Notes, References
- Research style unlocks a new "Research Type" settings tab

**Research Type tab**
- Appears in Settings only for Research-style projects
- Two options: **Academics** (standard outline/sources layout) and **Pastoral Sermons**

**Pastoral Sermons layout**
- When Pastoral Sermons is selected and saved, the editor pane splits horizontally
- Top pane: live **Bible scripture viewer** with:
  - Translation picker: KJV, WEB, BBE, ASV, Darby, YLT
  - Reference input (e.g. `John 3:16`, `Psalm 23`, `Romans 8:1-8`)
  - Verse-numbered display pulled from bible-api.com (no account required)
  - Vertically resizable divider between scripture and writing panes
- Bottom pane: standard writing editor
- Layout applies immediately after saving settings and persists across sessions

**Version tracking**
- Version number now shown in the toolbar (`v0.5`)
- Version displayed in server startup log and `/api/health` endpoint
- This CHANGELOG tracks all future increments

### Improvements

**Hot-Links auto-registration**
- Creating character or place pages from the Characters/Places settings tabs now automatically registers those documents as Hot-Links with the correct type badge
- No duplicate entries — documents already linked are skipped
- Hot-Links panel and document picker refresh immediately after creation

**Status bar always visible**
- The goal progress bar at the bottom of the editor now appears as soon as any project is open, even when no goals are set
- Shows placeholder text ("no daily goal" / "no final goal") until goals are configured in Settings → Goals

---

## Version History

| Version | Date | Summary |
|---------|------|---------|
| 2.1 | 2026-03 | Frontend split — EJS templates + static JS files |
| 2.0 | 2026-03 | Project Settings modal regression fix |
| 1.9 | 2026-03 | Bible fetcher 404/429 handling; SSO/settings bug fixes |
| 1.8 | 2026-03 | Real-time collaboration (socket.io), share modal, admin panel |
| 1.7 | 2026-03 | Google SSO authentication (optional, single-user default preserved) |
| 1.6 | 2026-03 | Bible fetcher parameterized API, no spaces in URLs |
| 1.5 | 2026-03 | Bible fetcher Cloudflare header fix |
| 1.4 | 2026-03 | Bible fetcher switched to bible-api.com |
| 1.3 | 2026-03 | Bible fetcher self-probing CDN slug detection (superseded by 1.4) |
| 1.2 | 2026-03 | Bible fetcher 403 fix — revert %20 encoding |
| 1.1 | 2026-03 | Hot-link fallback names + export replacement; book name encoding fix |
| 1.0 | 2026-03 | Project type labels on home screen |
| 0.9 | 2026-03 | Bible fetcher audit + selective repair |
| 0.8 | 2026-03 | Bible fetch as separate post-install step |
| 0.7 | 2026-03 | Bible dropdown navigation, 50% resize cap |
| 0.6 | 2026-03 | Offline Bible library, local API, all 6 translations bundled |
| 0.5 | 2026-03 | Research/Pastoral Sermons, Bible pane, version tracking, HL auto-register |

---

*ScribeFlow is self-hosted. Deploy via Docker (`docker compose up -d`) or Proxmox LXC (`bash lxc/install.sh`). Data persists in the `scribeflow_data` volume across all updates.*

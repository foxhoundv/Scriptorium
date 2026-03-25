# ScribeFlow Changelog

All notable changes are documented here. Version increments by tenths.

---

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
| 1.1 | 2026-03 | Hot-link fallback names + export replacement |
| 1.3 | 2026-03 | Bible fetcher self-probing CDN slug detection |
| 1.2 | 2026-03 | Bible fetcher 403 fix — revert %20 encoding |
| 1.1 | 2026-03 | Bible fetcher book name encoding fix (reverted) |
| 1.0 | 2026-03 | Project type labels on home screen |
| 0.9 | 2026-03 | Bible fetcher audit + selective repair |
| 0.8 | 2026-03 | Bible fetch as separate post-install step |
| 0.7 | 2026-03 | Bible dropdown navigation, 50% resize cap |
| 0.6 | 2026-03 | Offline Bible library, local API, all 6 translations bundled |
| 0.5 | 2026-03 | Research/Pastoral Sermons, Bible pane, version tracking, HL auto-register |

---

*ScribeFlow is self-hosted. Deploy via Docker (`docker compose up -d`) or Proxmox LXC (`bash lxc/install.sh`). Data persists in the `scribeflow_data` volume across all updates.*

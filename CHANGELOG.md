# ScribeFlow Changelog

All notable changes are documented here. Version increments by tenths.

---

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
| 0.7 | 2026-03 | Bible dropdown navigation, 50% resize cap |
| 0.6 | 2026-03 | Offline Bible library, local API, all 6 translations bundled |
| 0.5 | 2026-03 | Research/Pastoral Sermons, Bible pane, version tracking, HL auto-register |

---

*ScribeFlow is self-hosted. Deploy via Docker (`docker compose up -d`) or Proxmox LXC (`bash lxc/install.sh`). Data persists in the `scribeflow_data` volume across all updates.*
